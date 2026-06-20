// ==UserScript==
// @name         Rocketlane Day Recap
// @version      4.45
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
    // your active window on a plant is strong evidence real config work happened there (vs a plant you
    // only clicked through). Pad the window a touch (saves often commit a few min after the last click)
    // and ignore commits outside it (e.g. nightly auto-snapshots).
    const CHANGE_PAD_LEAD_MS = 2 * 60 * 1000; // count commits from 2 min before your first action…
    const CHANGE_PAD_TAIL_MS = 6 * 60 * 1000; // …through 6 min after your last (catches save-triggered commits)
    // Commits split into SCHEDULED snapshots (automatic, regular — hourly at :00/:01, nightly ~00:03,
    // daily ~08:31) vs CHANGE-TRIGGERED (off-the-hour) = real config work. Plant-2701 data: 95/173 commits
    // sit at :00/:01. Only change-triggered commits drive the 🔧 badge and feed the time estimate; the
    // scheduled snapshots are filtered out as noise (see isScheduledCommit). Bands are tunable constants.
    const SCHED_MINUTE_MAX  = 1;   // minute ≤1 (:00/:01) → scheduled hourly snapshot
    const SCHED_NIGHTLY_MAX = 5;   // hour 00, minute ≤5 → nightly ~00:03 cron
    const SCHED_DAILY_MIN   = 30;  // hour 08, …
    const SCHED_DAILY_MAX   = 32;  // …minute 30-32 → daily ~08:31 snapshot (narrow; overlaps shift start)
    // Commit → time fusion: a sub-tool config session (phpMyAdmin / Designer / Direct / VNC) logs very few
    // pang clicks and the save commits a while AFTER your last click, so the click-only estimate misses it.
    // When a sparse-click visit (≤ SPARSE_CLICK_MAX) that opened a config surface (an edit/access/vnc action)
    // has a real change-triggered commit, credit the span from your first click to that commit, clamped.
    // Purely ADDITIVE over the click baseline (base_minutes) — click-heavy plants are untouched (no regression).
    const SPARSE_CLICK_MAX      = 2;              // a sub-tool config session logs ≤2 pang clicks
    const COMMIT_SESSION_MIN_MS = 5 * 60 * 1000;  // min credit for such a session (even a near-instant save)
    const COMMIT_SESSION_MAX_MS = 20 * 60 * 1000; // max credit, and how far past your last click to look for the session-ending commit
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

    // ===== "What changed" detail (config-commit diff drill-down) =====================
    // Backed by two more changes.qxs services (same JSON-RPC / batching / http-origin rules as
    // gmFetchCommitsBatch): tables.php/get_tables_patch says which tables a commit touched (via a
    // `mode` flag), and data.php/get_two_versions returns a table's old+new content (base64 TSV).
    // We classify noise/blobs/added-devices from the table NAME+mode BEFORE fetching, so the huge
    // relink tables and graphic blobs are summarised without ever being downloaded.
    const MAX_COMMITS_DETAILED = 3;   // newest-first; older window commits are noted, not detailed
    const MAX_TABLES_PER_COMMIT = 14; // cap fetched (param/settings) tables per commit
    const CHG_CHUNK = 10;             // a collapsed section reveals this many lines per "+N more changes" click
    const CHANGE_FOOT_CAP = 4;        // max footnote tokens per commit
    const CHANGE_VAL_CLIP = 80;       // clip a from/to value to this many chars (AFTER comparing)
    const CHG_NOISE_RE = /^iw_lnk_|_id_to_/i;       // mechanical relink/index tables — never fetched
    const CHG_BLOB_TABLE_RE = /graphic_designer/i;  // multi-KB xml/json/png — summarised, never diffed as text
    const CHG_DEV_TOKEN_RE = /(?:da3_)?(mc\d{6}_\d{4}|sm\d+)/i; // device token inside a driver table name
    const CHG_NAME_COLS = ['name', 'setting', 'par_name', 'key', 'tag', 'alias_text'];
    // These three tables carry the config info worth reading. They're fetched first (CHG_PRIORITY) so a
    // big snapshot can't starve them out of the MAX_TABLES_PER_COMMIT fetch cap. In the drawer,
    // iw_sys_plant_units + iw_sys_graphic_designer are shown immediately; iw_sys_plant_settings goes in
    // its own collapsible "Plant settings" section (it changes on almost every commit); the rest → "More changes".
    const CHG_PRIORITY = new Set(['iw_sys_plant_settings', 'iw_sys_plant_units', 'iw_sys_graphic_designer']);
    const CHG_UNIT_LIST_CAP = 6;   // list ≤N unit add/removes/edits inline; beyond that → a count + a "show all" expander (guards full-rebuild snapshots, e.g. units 104→2)
    const CHG_COALESCE_MIN  = 4;   // ≥N param rows with the SAME col/from/to (e.g. a regroup) collapse to one "⚙ <col>: a → b (N rows)" line
    const CHG_SEP = String.fromCharCode(1); // row-key delimiter — won't appear in config values
    const CHG_TABLE_FRIENDLY = {
        iw_sys_plant_settings: 'Plant settings', iw_sys_graphic_designer: 'Graphic panel',
        iw_sys_order_no: 'Device list', iw_sys_plant_units: 'Plant units',
        iw_sys_virtual_values: 'Virtual values', iw_lnk_driver_id_to_no: 'Driver-ID links',
    };
    const CHG_COL_LABELS = { grp: 'group', val: 'value', value: 'value', revision: 'revision', xml: 'layout', json: 'layout', picture: 'background image' };
    const _patchCache = new Map(); // commitId -> { table: {mode, struct, content} }
    const _diffCache  = new Map(); // 'commitId|table' -> { unreadable, added[], removed[], modified[] }

    async function gmFetchTablesPatchBatch(commitIds) {
        const base = await apiOrigin();
        return new Promise(resolve => {
            const reqs = commitIds.map((cid, i) => ({ jsonrpc: '2.0', method: 'get_tables_patch', params: { commit: String(cid) }, id: i }));
            GM_xmlhttpRequest({
                method: 'POST', url: base + '/services/changes/tables.php',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, data: JSON.stringify(reqs), timeout: 60000,
                onload: r => {
                    const out = {};
                    try {
                        const parsed = JSON.parse(r.responseText);
                        const list = Array.isArray(parsed) ? parsed : [parsed];
                        for (let k = 0; k < list.length; k++) {
                            const item = list[k];
                            const idx = (typeof item?.id === 'number') ? item.id : k;
                            const cid = commitIds[idx];
                            if (cid != null) out[cid] = (item && item.result && typeof item.result === 'object') ? item.result : {};
                        }
                    } catch {}
                    resolve(out);
                },
                onerror: () => resolve({}), ontimeout: () => resolve({}),
            });
        });
    }

    async function gmFetchTwoVersionsBatch(jobs) {
        const base = await apiOrigin();
        return new Promise(resolve => {
            const reqs = jobs.map((j, i) => ({ jsonrpc: '2.0', method: 'get_two_versions', params: { table_name: j.table_name, commit: String(j.commit) }, id: i }));
            GM_xmlhttpRequest({
                method: 'POST', url: base + '/services/changes/data.php',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, data: JSON.stringify(reqs), timeout: 60000,
                onload: r => {
                    const out = new Array(jobs.length).fill(null);
                    try {
                        const parsed = JSON.parse(r.responseText);
                        const list = Array.isArray(parsed) ? parsed : [parsed];
                        for (let k = 0; k < list.length; k++) {
                            const item = list[k];
                            const idx = (typeof item?.id === 'number') ? item.id : k;
                            if (idx >= 0 && idx < out.length) out[idx] = (item && item.result) ? item.result : null;
                        }
                    } catch {}
                    resolve(out);
                },
                onerror: () => resolve(jobs.map(() => null)), ontimeout: () => resolve(jobs.map(() => null)),
            });
        });
    }

    function chgTokenOf(t) { const m = String(t).match(CHG_DEV_TOKEN_RE); return m ? m[1].toUpperCase() : null; }
    function chgHumanizeTable(name) {
        if (CHG_TABLE_FRIENDLY[name]) return CHG_TABLE_FRIENDLY[name];
        const tok = chgTokenOf(name);
        if (/^iw_par_/.test(name) && tok) return 'Parameters: ' + tok;
        if (/^iw_set_/.test(name) && tok) return 'Setup: ' + tok;
        let s = String(name).replace(/^iw_/, '')
            .replace(/^sys_/, 'System ').replace(/^par_/, 'Parameters ').replace(/^set_/, 'Setup ')
            .replace(/^lnk_/, 'Link ').replace(/^gen_/, 'General ');
        s = s.replace(/da3_/g, '').replace(/_/g, ' ').trim();
        return s ? s.charAt(0).toUpperCase() + s.slice(1) : String(name);
    }
    function chgColLabel(c) { return CHG_COL_LABELS[c] || String(c).replace(/_/g, ' '); }
    function chgClip(s) { s = String(s == null ? '' : s); return s.length > CHANGE_VAL_CLIP ? s.slice(0, CHANGE_VAL_CLIP) + '…' : s; }
    function chgIsParamTable(t) { return /^iw_sys_plant_settings$|_param$|^iw_set_|_settings$/.test(t); }

    function chgDecodeSide(side) {
        if (!side || !side.data) return null;
        let text;
        try { const bin = atob(side.data); const b = Uint8Array.from(bin, c => c.charCodeAt(0)); text = new TextDecoder('utf-8').decode(b); }
        catch (e) { return 'UNREADABLE'; }
        const fields = side.fields || [];
        const pkIdx = (side.pk && Array.isArray(side.pk.indexes) && side.pk.indexes.length) ? side.pk.indexes : null;
        const rdIdx = fields.indexOf('row_date');
        const rows = new Map();
        for (const line of text.split('\n')) {
            if (line === '') continue;
            const cols = line.split('\t');
            const key = pkIdx ? pkIdx.map(i => cols[i]).join(CHG_SEP) : cols.join(CHG_SEP); // no PK → full row (incl. row_date) so distinct rows never collapse
            rows.set(key, cols);
        }
        return { fields, pkIdx, rdIdx, rows };
    }
    function chgDiff(ver) {
        const o = chgDecodeSide(ver && ver.old), n = chgDecodeSide(ver && ver.new);
        if (o === 'UNREADABLE' || n === 'UNREADABLE') return { unreadable: true, added: [], removed: [], modified: [] };
        const oldRows = o ? o.rows : new Map(), newRows = n ? n.rows : new Map();
        const oldFields = (o && o.fields) || [], newFields = (n && n.fields) || [];
        const oldIdxByName = {}; oldFields.forEach((f, i) => { if (!(f in oldIdxByName)) oldIdxByName[f] = i; });
        const added = [], removed = [], modified = [];
        // Compare values by column NAME, not position — so a struct change (a column inserted/reordered
        // in a mod:struct:content commit) can't produce phantom "X → Y" lines against the wrong column.
        for (const [k, nc] of newRows) {
            const oc = oldRows.get(k);
            if (!oc) { added.push({ key: k, cols: nc, fields: newFields }); continue; }
            for (let i = 0; i < newFields.length; i++) {
                const name = newFields[i];
                if (name === 'row_date') continue;
                const oi = oldIdxByName[name];
                if (oi === undefined) continue; // column only on the new side (structural) — not a value edit
                if ((nc[i] || '') !== (oc[oi] || '')) modified.push({ key: k, col: name, from: oc[oi], to: nc[i], fields: newFields, cols: nc });
            }
        }
        for (const [k, oc] of oldRows) { if (!newRows.has(k)) removed.push({ key: k, cols: oc, fields: oldFields }); }
        return { unreadable: false, added, removed, modified };
    }
    function chgRowLabel(entry) {
        const f = entry.fields || [];
        const nameCol = CHG_NAME_COLS.find(c => f.includes(c) && entry.cols[f.indexOf(c)]);
        const pkParts = String(entry.key).split(CHG_SEP).filter(p => p !== '');
        if (nameCol) {
            const nameVal = entry.cols[f.indexOf(nameCol)];
            const extras = pkParts.filter(p => p !== nameVal);
            return extras.length ? `${nameVal} (${extras.join(', ')})` : nameVal;
        }
        return pkParts.length ? pkParts.join(' / ') : '(row)';
    }
    function chgClassify(table, mode) {
        if (mode === 'add') return { kind: 'add', token: chgTokenOf(table) };
        if (mode === 'del') return { kind: 'del', token: chgTokenOf(table) };
        if (CHG_NOISE_RE.test(table)) return { kind: 'noise' };
        return { kind: 'fetch' };
    }
    // Device id from a driver table name: iw_par_<tok>_(groups|param) / iw_set_<tok>, da3_ prefix stripped.
    // Handles every driver family (AK3 da3_*, BACNET energy valves, modbus, …), not just the narrow CHG_DEV_TOKEN_RE.
    function chgDeviceToken(table) {
        const m = String(table).match(/^iw_(?:par|set)_(?:da3_)?(.+?)(?:_groups|_param)?$/);
        return m ? m[1] : null;
    }
    function chgBlobToken(table, d) {
        let extra = '';
        const rev = d.modified.find(m => m.col === 'revision');
        if (rev) extra += ` rev ${chgClip(rev.from)}→${chgClip(rev.to)}`;
        const pic = d.modified.find(m => /picture|image|filename/i.test(m.col || ''));
        if (pic) extra += ' · background image swapped';
        const any = d.modified[0] || d.added[0] || d.removed[0];
        const label = any ? chgRowLabel(any) : chgHumanizeTable(table);
        return `Graphic '${label}' edited${extra}`;
    }
    function chgPushOrdinary(push, table, d) {
        const ft = chgHumanizeTable(table);
        if (d.added.length) { if (d.added.length <= 3) d.added.forEach(a => push('+ ' + chgRowLabel(a), 'add')); else push(`+ ${d.added.length} rows added to ${ft}`, 'add'); }
        if (d.removed.length) { if (d.removed.length <= 3) d.removed.forEach(r => push('- ' + chgRowLabel(r), 'del')); else push(`- ${d.removed.length} rows removed from ${ft}`, 'del'); }
        if (d.modified.length && !d.added.length && !d.removed.length) {
            const rows = new Set(d.modified.map(m => m.key)).size;
            push(`${ft}: ${rows} ${rows === 1 ? 'row' : 'rows'} changed`, 'mod');
        }
    }
    // iw_sys_plant_units rows: unit_id (e.g. "ING_EXT_05") + unit_name (e.g. "Belimo Energimåler"). Lead with
    // the human name when present, keep the id in parens — so both the descriptive cases are covered.
    function chgUnitLabel(e) {
        const f = e.fields || [];
        const id = f.indexOf('unit_id') >= 0 ? e.cols[f.indexOf('unit_id')] : '';
        const nm = f.indexOf('unit_name') >= 0 ? e.cols[f.indexOf('unit_name')] : '';
        if (nm && id) return `${nm} (${id})`;
        return nm || id || chgRowLabel(e);
    }
    function chgPushUnits(push, d, consumed) {
        const adds = d.added.filter(a => !(consumed && consumed.has(a.key)));
        // Coalesce bulk add/remove into a count, but keep the full list on the line as `more` so the drawer
        // can offer a "show all" expander. A "rebuild" snapshot can add/remove 100+ units (units cleared in
        // one commit, re-added in the next — see CLAUDE.md §4): noise inline, but you still want to read it.
        if (adds.length > CHG_UNIT_LIST_CAP) push(`+ ${adds.length} units added`, 'add', adds.map(a => '+ Unit ' + chgUnitLabel(a)));
        else for (const a of adds) push('+ Unit ' + chgUnitLabel(a), 'add');
        if (d.removed.length > CHG_UNIT_LIST_CAP) push(`- ${d.removed.length} units removed`, 'del', d.removed.map(r => '- Unit ' + chgUnitLabel(r)));
        else for (const r of d.removed) push('- Unit ' + chgUnitLabel(r), 'del');
        const byUnit = new Map(); // group a unit's field changes onto one line
        for (const m of d.modified) { if (!byUnit.has(m.key)) byUnit.set(m.key, { ref: m, changes: [] }); byUnit.get(m.key).changes.push(m); }
        const unitLine = u => `⚙ Unit ${chgUnitLabel(u.ref)} — ${u.changes.map(c => `${chgColLabel(c.col)}: ${chgClip(c.from)} → ${chgClip(c.to)}`).join(', ')}`;
        if (byUnit.size > CHG_UNIT_LIST_CAP) { push(`⚙ ${byUnit.size} units changed`, 'mod', [...byUnit.values()].map(unitLine)); return; }
        for (const u of byUnit.values()) push(unitLine(u), 'mod');
    }
    // Settings / parameter tables → "⚙ <row> <col>: a → b" lines. Two readability touches: drop the
    // redundant "value" word (a setting's value is what's changing anyway → "packet_interval (AK3): 400 → 4000"),
    // and coalesce a bulk identical change — e.g. a regroup that bumps `grp` 3→6 on many rows — into ONE
    // "⚙ group: 3 → 6 (N rows)" line instead of N near-identical lines. Distinct changes (the usual settings
    // case) stay per-row. No cap — the drawer reveals long sections in chunks (renderChunked).
    function chgPushParams(push, d, coalesce) {
        const rowLine = m => { const col = (m.col === 'value' || m.col === 'val') ? '' : ' ' + chgColLabel(m.col); return `⚙ ${chgRowLabel(m)}${col}: ${chgClip(m.from)} → ${chgClip(m.to)}`; };
        if (coalesce) {
            // Group by (col, from, to) so a bulk identical change (e.g. a regroup bumping `grp` 3→6 on dozens
            // of rows) collapses to one "⚙ group: 3 → 6 (N rows)" line. Only for "More changes" tables — the
            // priority Plant-settings section is always per-row so you can see exactly which setting changed.
            const groups = new Map();
            for (const m of d.modified) { const k = m.col + CHG_SEP + m.from + CHG_SEP + m.to; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(m); }
            for (const arr of groups.values()) {
                if (arr.length >= CHG_COALESCE_MIN) { const m0 = arr[0]; push(`⚙ ${chgColLabel(m0.col)}: ${chgClip(m0.from)} → ${chgClip(m0.to)} (${arr.length} rows)`, 'mod'); }
                else for (const m of arr) push(rowLine(m), 'mod');
            }
        } else for (const m of d.modified) push(rowLine(m), 'mod');
        for (const a of d.added) push('+ ' + chgRowLabel(a), 'add');
        for (const r of d.removed) push('- ' + chgRowLabel(r), 'del');
    }
    // iw_sys_graphic_designer (PK = panel name). Promote graphic edits from a footnote to real lines:
    // which panel, its revision bump, and a hint of what changed (layout / background image) read from
    // which blob columns differ. The xml/json/png blobs themselves are never shown as text.
    function chgPushGraphic(push, d) {
        for (const a of d.added) push('+ Graphic panel ' + chgRowLabel(a), 'add');
        for (const r of d.removed) push('- Graphic panel ' + chgRowLabel(r), 'del');
        const byPanel = new Map();
        for (const m of d.modified) { if (!byPanel.has(m.key)) byPanel.set(m.key, []); byPanel.get(m.key).push(m); }
        for (const [key, mods] of byPanel) {
            const panel = String(key).split(CHG_SEP).filter(Boolean).join(' / ') || '(panel)';
            const rev = mods.find(m => m.col === 'revision');
            const what = [];
            if (mods.some(m => m.col === 'xml' || m.col === 'json')) what.push('layout');
            if (mods.some(m => /picture|image|thumb|icon/i.test(m.col || ''))) what.push('background image');
            let txt = 'Graphic ' + panel;
            if (rev) txt += `: rev ${chgClip(rev.from)} → ${chgClip(rev.to)}`;
            if (what.length) txt += (rev ? ' · ' : ': ') + what.join(' + ') + ' edited';
            push(txt, 'mod');
        }
    }
    function chgBuildCommit(commit, classes, diffGet, droppedTables) {
        // Always-visible, in this order: (1) units = iw_sys_plant_units (incl. unit-backed device adds),
        // (2) graphic = iw_sys_graphic_designer. Then (3) sett = iw_sys_plant_settings in its own collapsible
        // "Plant settings" section, and (4) oth = everything else → capped, collapsible "More changes".
        // foot = terse footnotes (relinks, unreadable, dropped). A line may carry `more: [strings]` → a
        // per-line "show all" expander (used for big unit add/remove lists).
        const units = [], graphic = [], sett = [], oth = [], foot = [];
        const uPush = (t, k, more) => units.push({ t, k: k || 'plain', more }); // k: add | del | mod | plain → colour
        const gPush = (t, k, more) => graphic.push({ t, k: k || 'plain', more });
        const sPush = (t, k, more) => sett.push({ t, k: k || 'plain', more });
        const oPush = (t, k, more) => oth.push({ t, k: k || 'plain', more });

        // Coalesce device add/del tables by token. A device creates iw_set_<tok> + iw_par_<tok>_groups/_param,
        // so a token with ≥2 add-tables (or one matching a freshly-added unit) is treated as a device.
        const addCount = {}, delCount = {};
        for (const x of classes) {
            const tok = (x.cls.kind === 'add' || x.cls.kind === 'del') ? chgDeviceToken(x.table) : null;
            if (!tok) continue;
            const bag = x.cls.kind === 'add' ? addCount : delCount;
            bag[tok] = (bag[tok] || 0) + 1;
        }

        // iw_sys_plant_units is the source of truth for unit/device names — map token → unit label.
        const unitsD = classes.some(x => x.table === 'iw_sys_plant_units') ? diffGet('iw_sys_plant_units') : null;
        const unitByToken = new Map(); // lowercased grp_name/order_no/unit_id → { label, key }
        if (unitsD && !unitsD.unreadable) {
            for (const a of unitsD.added) {
                const f = a.fields, info = { label: chgUnitLabel(a), key: a.key };
                for (const tcol of ['grp_name', 'order_no', 'unit_id']) { const i = f.indexOf(tcol); const val = i >= 0 ? a.cols[i] : ''; if (val) unitByToken.set(String(val).toLowerCase(), info); }
            }
        }
        const matchUnit = tok => unitByToken.get(String(tok).toLowerCase());

        const devTokenSet = new Set(Object.keys(addCount).filter(tok => addCount[tok] >= 2 || matchUnit(tok)));
        const consumed = new Set();
        for (const tok of devTokenSet) {
            const u = matchUnit(tok);
            // A device backed by a freshly-added unit IS a plant_units change → units group (top); the unit
            // is consumed so chgPushUnits won't re-list it. A pure driver token (no unit row) → "More changes".
            if (u) { uPush('+ Device added: ' + u.label, 'add'); consumed.add(u.key); } // named by the added unit (e.g. "Belimo Energimåler")
            else oPush('+ Device added: ' + tok, 'add');
        }
        for (const tok of Object.keys(delCount)) { if (delCount[tok] >= 2) oPush('- Device removed: ' + tok, 'del'); }
        const hadDevice = devTokenSet.size > 0;

        for (const x of classes) {
            const { table, cls } = x;
            if (cls.kind === 'add') {
                const tok = chgDeviceToken(table);
                if (tok && devTokenSet.has(tok)) continue; // folded into the device line
                oPush('+ New table: ' + chgHumanizeTable(table), 'add');
                continue;
            }
            if (cls.kind === 'del') {
                const tok = chgDeviceToken(table);
                if (tok && delCount[tok] >= 2) continue;
                oPush('- Removed table: ' + chgHumanizeTable(table), 'del');
                continue;
            }
            if (cls.kind === 'noise') { if (!hadDevice) foot.push('driver-ID relink'); continue; }
            if (hadDevice && table === 'iw_sys_order_no') continue; // device token already in the device line
            const d = diffGet(table);
            if (!d) continue;
            if (d.unreadable) { foot.push('unreadable change in ' + chgHumanizeTable(table)); continue; }
            // Priority tables first (graphic before the generic blob branch so it gets real lines, not a footnote).
            if (table === 'iw_sys_plant_units') { chgPushUnits(uPush, d, consumed); continue; } // (1) units group — top
            if (table === 'iw_sys_graphic_designer') { chgPushGraphic(gPush, d); continue; }      // (2) graphic group — second
            if (table === 'iw_sys_plant_settings') { chgPushParams(sPush, d); continue; } // (3) own collapsible "Plant settings" section
            if (CHG_BLOB_TABLE_RE.test(table)) { foot.push(chgBlobToken(table, d)); continue; } // any other blob table → footnote
            if (chgIsParamTable(table)) { chgPushParams(oPush, d, true); continue; } // coalesce bulk-identical changes in "More changes"
            chgPushOrdinary(oPush, table, d);
        }
        if (droppedTables > 0) foot.push(`${droppedTables} more table${droppedTables === 1 ? '' : 's'} not detailed`);

        // No section is truncated in the model — the drawer reveals long sections in chunks ("+N more changes").
        const footOverflow = Math.max(0, foot.length - CHANGE_FOOT_CAP);
        const footShown = foot.slice(0, CHANGE_FOOT_CAP);
        // (The "nothing meaningful changed" fallback is rendered inline by renderChangeDetail when every
        // group is empty — so it isn't mislabelled inside a "Plant units (1)" collapse.)
        return { time: tsToLocalTime(tsFromPangDate(commit.date)), units, graphic, settings: sett, oth, foot: footShown, footOverflow };
    }

    // Lazily fetch + diff the config changes for ONE visit's in-window commits. Result is cached on
    // the visit and in module-scope maps keyed by immutable commit id (re-expand / shared commits free).
    function loadChangeDetail(v) {
        if (v._changeDetail) return Promise.resolve(v._changeDetail);
        if (v._changeDetailPromise) return v._changeDetailPromise; // coalesce overlapping expands → one fetch
        const p = (async () => {
            const all = v.window_commits || [];
            const commits = all.slice().sort((a, b) => tsFromPangDate(b.date) - tsFromPangDate(a.date)).slice(0, MAX_COMMITS_DETAILED);
            const olderCount = Math.max(0, all.length - commits.length);
            const needIds = commits.map(c => c.id).filter(id => !_patchCache.has(id));
            if (needIds.length) { const pm = await gmFetchTablesPatchBatch(needIds); needIds.forEach(id => _patchCache.set(id, pm[id] || {})); }
            const plan = commits.map(c => {
                const patch = _patchCache.get(c.id) || {};
                const classes = Object.keys(patch).filter(t => patch[t] && patch[t].mode).map(t => ({ table: t, mode: patch[t].mode, cls: chgClassify(t, patch[t].mode) }));
                // Fetch the priority tables first: with MAX_TABLES_PER_COMMIT (14), a full snapshot that
                // touches 100+ tables would otherwise drop plant_settings/units/graphic before they're read.
                const fetchKind = classes.filter(x => x.cls.kind === 'fetch')
                    .sort((a, b) => (CHG_PRIORITY.has(b.table) ? 1 : 0) - (CHG_PRIORITY.has(a.table) ? 1 : 0));
                const fetchTables = fetchKind.slice(0, MAX_TABLES_PER_COMMIT);
                return { commit: c, classes, fetchTables, dropped: fetchKind.length - fetchTables.length };
            });
            const jobs = [];
            plan.forEach(pl => pl.fetchTables.forEach(x => jobs.push({ table_name: x.table, commit: pl.commit.id })));
            const toFetch = jobs.filter(j => !_diffCache.has(j.commit + '|' + j.table_name));
            if (toFetch.length) { const res = await gmFetchTwoVersionsBatch(toFetch); toFetch.forEach((j, i) => _diffCache.set(j.commit + '|' + j.table_name, chgDiff(res[i]))); }
            const model = plan.map(pl => chgBuildCommit(pl.commit, pl.classes, table => _diffCache.get(pl.commit.id + '|' + table), pl.dropped));
            v._changeDetail = { commits: model, olderCount };
            return v._changeDetail;
        })();
        v._changeDetailPromise = p;
        p.catch(() => { v._changeDetailPromise = null; }); // failed load → allow a later retry
        return p;
    }

    // Render a resolved change-detail model into the drawer. All text via textContent — values are raw
    // plant config (XML/JSON/names) and must never reach innerHTML.
    function renderChangeDetail(detailEl, model, ui) {
        detailEl.textContent = '';
        // Per-drawer UI state, persisted on the visit so it survives a re-render (applyAndRender rebuilds the
        // whole list): which sections are expanded and how many lines each has revealed. Keyed (commit#:group).
        ui = ui || {}; ui.sec = ui.sec || {};
        const secState = key => (ui.sec[key] = ui.sec[key] || { expanded: false, revealed: CHG_CHUNK });
        // One line → a div; if the line carries `more`, append a "show all" toggle that reveals a sub-list.
        const mkLine = line => {
            const d = document.createElement('div'); d.className = 'chg-line chg-' + (line.k || 'plain'); d.textContent = line.t;
            if (!line.more || !line.more.length) return d;
            const body = document.createElement('div'); body.className = 'chg-more-body'; body.hidden = true;
            for (const s of line.more) { const sub = document.createElement('div'); sub.className = 'chg-line chg-' + (line.k || 'plain'); sub.textContent = s; body.appendChild(sub); }
            const tog = document.createElement('span'); tog.className = 'chg-showall'; tog.setAttribute('role', 'button'); tog.tabIndex = 0;
            const setLabel = () => { tog.textContent = body.hidden ? 'show all' : 'hide'; };
            const flip = () => { body.hidden = !body.hidden; setLabel(); };
            setLabel();
            tog.addEventListener('click', flip);
            tog.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } });
            d.appendChild(tog);
            const frag = document.createDocumentFragment(); frag.appendChild(d); frag.appendChild(body); return frag;
        };
        // Reveal `lines` into `container` CHG_CHUNK at a time. The "+N more changes" line is itself clickable
        // and appends the next chunk on each click (so a big section isn't dumped at once); it removes itself
        // when nothing's left. Lines become DOM nodes only as they're revealed.
        const renderChunked = (container, lines, st) => {
            let shown = 0;
            const more = document.createElement('div'); more.className = 'chg-line chg-more-link'; more.setAttribute('role', 'button'); more.tabIndex = 0;
            container.appendChild(more);
            const draw = () => { // show up to st.revealed lines (restores the reveal count after a re-render)
                const target = Math.min(st.revealed || CHG_CHUNK, lines.length);
                for (; shown < target; shown++) container.insertBefore(mkLine(lines[shown]), more);
                const rem = lines.length - shown;
                if (rem > 0) more.textContent = '+' + rem + ' more changes'; else more.remove();
            };
            const revealMore = () => { st.revealed = Math.min((st.revealed || CHG_CHUNK) + CHG_CHUNK, lines.length); draw(); };
            more.addEventListener('click', revealMore);
            more.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); revealMore(); } });
            draw();
        };
        // A titled collapsible section ("▸ Title (N)"); its expand + reveal state is restored from `st`.
        const renderCollapse = (title, lines, st) => {
            const body = document.createElement('div'); body.className = 'chg-more-body'; body.hidden = !st.expanded;
            renderChunked(body, lines, st);
            const tog = document.createElement('div'); tog.className = 'chg-more-toggle'; tog.setAttribute('role', 'button'); tog.tabIndex = 0;
            const setLabel = () => { tog.textContent = (body.hidden ? '▸ ' : '▾ ') + title + ' (' + lines.length + ')'; };
            const flip = () => { body.hidden = !body.hidden; st.expanded = !body.hidden; setLabel(); };
            setLabel();
            tog.addEventListener('click', flip);
            tog.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } });
            detailEl.appendChild(tog); detailEl.appendChild(body);
        };
        const hdr = document.createElement('div');
        hdr.className = 'chg-hdr';
        hdr.textContent = 'Config snapshot during your visit · automatic, no author recorded';
        detailEl.appendChild(hdr);
        const multi = model.commits.length > 1;
        let ci = 0;
        for (const c of model.commits) {
            const pre = (ci++) + ':'; // key sections per commit so a multi-commit drawer doesn't share state
            if (multi) { const th = document.createElement('div'); th.className = 'chg-time'; th.textContent = c.time; detailEl.appendChild(th); }
            // Each non-empty group is its own "▸ Title (N)" collapse; expand + reveal state restored from `ui`.
            if (c.units.length) renderCollapse('Plant units', c.units, secState(pre + 'units'));                           // 1. units
            if (c.graphic.length) renderCollapse('Graphic', c.graphic, secState(pre + 'graphic'));                        // 2. graphic
            if (c.settings && c.settings.length) renderCollapse('Plant settings', c.settings, secState(pre + 'settings')); // 3. settings
            if (c.oth.length) renderCollapse('More changes', c.oth, secState(pre + 'oth'));                               // 4. the rest
            const anyContent = c.units.length || c.graphic.length || (c.settings && c.settings.length) || c.oth.length;
            if (!anyContent && !c.foot.length) detailEl.appendChild(mkLine({ t: 'Snapshot recorded — no parameter changes', k: 'plain' }));
            if (c.foot.length) { const f = document.createElement('div'); f.className = 'chg-foot'; f.textContent = (anyContent ? '+ also: ' : '') + c.foot.join(', ') + (c.footOverflow ? `, +${c.footOverflow} more` : ''); detailEl.appendChild(f); }
        }
        if (model.olderCount) { const o = document.createElement('div'); o.className = 'chg-foot'; o.textContent = `+${model.olderCount} earlier commits not detailed`; detailEl.appendChild(o); }
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

    // A config commit's date is "YYYY-MM-DD HH:MM:SS" in Europe/Oslo wall-clock. Tell SCHEDULED snapshots
    // (hourly :00/:01, nightly ~00:03, daily ~08:31) from CHANGE-TRIGGERED (off-the-hour) ones by reading
    // minute/hour from the RAW STRING — not a parsed Date, which would shift on a non-Oslo machine. A
    // genuine save that happens to land at :00/:01 is misread as scheduled (only loses its badge — the
    // click baseline still credits the minute); accepted, since 95/173 commits really are scheduled.
    function isScheduledCommit(commit) {
        const s = commit && commit.date;
        if (typeof s !== 'string' || s.length < 16) return false; // unclassifiable → treat as real (don't hide it)
        const hh = +s.slice(11, 13), mm = +s.slice(14, 16);
        if (mm <= SCHED_MINUTE_MAX) return true;                                     // hourly :00/:01
        if (hh === 0 && mm <= SCHED_NIGHTLY_MAX) return true;                        // nightly ~00:03
        if (hh === 8 && mm >= SCHED_DAILY_MIN && mm <= SCHED_DAILY_MAX) return true; // daily ~08:31
        return false;                                                               // off-the-hour = change-triggered
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
            v.base_minutes = v.estimated_minutes; // immutable click-only floor; commit fusion adds on top in ensureChangesEnriched
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
            for (const v of visits) { v.estimated_minutes = mins[v.plant_id] || 0; v.base_minutes = v.estimated_minutes; }
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
        #${PANEL_ID} .controls .datewrap { flex: 1; position: relative; }
        #${PANEL_ID} .controls .datebtn { width: 100%; padding: 7px 10px; border: 1px solid #c6c6c6; border-radius: 6px; font-size: 13px; background: #fff; color: #161616; font-weight: 500; text-align: left; cursor: pointer; }
        #${PANEL_ID} .controls .datebtn:hover { border-color: #0f62fe; }
        #${PANEL_ID} .datecal { position: fixed; z-index: 2147483646; width: 250px; box-sizing: border-box; background: #fff; border: 1px solid #e0e0e0; border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,.16); padding: 10px 12px 12px; }
        #${PANEL_ID} .datecal-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
        #${PANEL_ID} .datecal-title { font-weight: 600; font-size: 14px; color: #161616; }
        #${PANEL_ID} .datecal .datecal-nav { width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; background: none; border: none; border-radius: 50%; color: #0f62fe; font-size: 18px; line-height: 1; cursor: pointer; }
        #${PANEL_ID} .datecal .datecal-nav:hover { background: #edf2ff; }
        #${PANEL_ID} .datecal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
        #${PANEL_ID} .datecal-wd { text-align: center; font-size: 10px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: #a8a8a8; padding-bottom: 4px; }
        #${PANEL_ID} .datecal .datecal-day { aspect-ratio: 1; display: flex; align-items: center; justify-content: center; border: none; background: none; font-size: 12.5px; color: #21272a; font-weight: 500; cursor: pointer; border-radius: 50%; transition: background .12s, color .12s; }
        #${PANEL_ID} .datecal .datecal-day:hover { background: #edf2ff; }
        #${PANEL_ID} .datecal .datecal-day.other { color: #c1c7cd; font-weight: 400; }
        #${PANEL_ID} .datecal .datecal-day.today { color: #0f62fe; font-weight: 700; }
        #${PANEL_ID} .datecal .datecal-day.sel { background: #0f62fe; color: #fff; font-weight: 600; }
        #${PANEL_ID} .datecal .datecal-day.sel:hover { background: #0353e9; }
        #${PANEL_ID} .datecal-foot { margin-top: 8px; padding-top: 8px; border-top: 1px solid #f0f0f0; display: flex; justify-content: flex-end; }
        #${PANEL_ID} .datecal .datecal-today { background: none; border: none; color: #0f62fe; font-size: 12px; font-weight: 600; cursor: pointer; padding: 3px 8px; border-radius: 6px; }
        #${PANEL_ID} .datecal .datecal-today:hover { background: #edf2ff; }
        #${PANEL_ID} .controls button {
            padding: 6px 10px; background: #0f62fe; color: #fff; border: none;
            border-radius: 4px; cursor: pointer; font-weight: 600;
        }
        #${PANEL_ID} .controls button:disabled { background: #c6c6c6; cursor: wait; }
        #${PANEL_ID} .results { overflow: auto; padding: 4px 0; flex: 1; }
        #${PANEL_ID} .row {
            padding: 8px 14px; border-bottom: 1px solid #f0f0f0;
            display: flex; flex-wrap: wrap; gap: 10px; align-items: baseline;
        }
        #${PANEL_ID} .row a {
            color: #0f62fe; text-decoration: none; font-weight: 600; min-width: 56px;
        }
        #${PANEL_ID} .row a:hover { text-decoration: underline; }
        #${PANEL_ID} .row .name { flex: 1; }
        #${PANEL_ID} .row .actions { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 4px; align-items: center; }
        #${PANEL_ID} .row .time { color: #6f6f6f; font-size: 12px; white-space: nowrap; text-align: right; }
        #${PANEL_ID} .row .estimate { color: #0f62fe; font-size: 11px; font-weight: 600; margin-top: 2px; }
        #${PANEL_ID} .row .chg { display: inline-block; margin-left: 6px; padding: 0 5px; border-radius: 3px; background: #defbe6; color: #0e6027; font-weight: 600; white-space: nowrap; cursor: pointer; }
        #${PANEL_ID} .row .chg-car { font-size: 9px; }
        #${PANEL_ID} .row .chg-detail { flex-basis: 100%; width: 100%; box-sizing: border-box; margin-top: 6px; padding: 8px 10px; background: #f4f4f4; border-radius: 6px; max-height: 220px; overflow: auto; }
        #${PANEL_ID} .row .chg-hdr { font-size: 11px; color: #6f6f6f; margin-bottom: 5px; }
        #${PANEL_ID} .row .chg-time { font-size: 11px; font-weight: 600; color: #525252; margin: 6px 0 2px; }
        #${PANEL_ID} .row .chg-line { font-size: 12px; color: #161616; line-height: 1.5; word-break: break-word; }
        #${PANEL_ID} .row .chg-line.chg-add { color: #0e6027; }
        #${PANEL_ID} .row .chg-line.chg-del { color: #a2191f; }
        #${PANEL_ID} .row .chg-line.chg-mod { color: #0043ce; }
        #${PANEL_ID} .row .chg-more-toggle { font-size: 11px; font-weight: 600; color: #0f62fe; cursor: pointer; margin-top: 5px; user-select: none; }
        #${PANEL_ID} .row .chg-more-toggle:hover { text-decoration: underline; }
        #${PANEL_ID} .row .chg-more-body { margin-top: 2px; padding-left: 8px; border-left: 2px solid #e0e0e0; }
        #${PANEL_ID} .row .chg-showall { margin-left: 8px; font-size: 11px; font-weight: 600; color: #0f62fe; cursor: pointer; user-select: none; white-space: nowrap; }
        #${PANEL_ID} .row .chg-showall:hover { text-decoration: underline; }
        #${PANEL_ID} .row .chg-more-link { color: #0f62fe; font-weight: 600; cursor: pointer; user-select: none; }
        #${PANEL_ID} .row .chg-more-link:hover { text-decoration: underline; }
        #${PANEL_ID} .row .chg-foot { font-size: 11px; color: #8d8d8d; margin-top: 4px; line-height: 1.4; word-break: break-word; }
        #${PANEL_ID} .row .act { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: #525252; white-space: nowrap; }
        #${PANEL_ID} .row .act .dot { width: 6px; height: 6px; border-radius: 50%; flex: none; background: #a8a8a8; }
        #${PANEL_ID} .row .act-edit   .dot { background: #0f62fe; }
        #${PANEL_ID} .row .act-server .dot { background: #ff832b; }
        #${PANEL_ID} .row .act-vnc    .dot { background: #8a3ffc; }
        #${PANEL_ID} .row .act-access .dot { background: #009d9a; }
        #${PANEL_ID} .row .act-diag   .dot { background: #a8a8a8; }
        #${PANEL_ID} .row .act-other  .dot { background: #a8a8a8; }
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
                <div class="datewrap">
                    <input type="date" value="${todayISO()}" hidden>
                    <button type="button" class="datebtn"></button>
                    <div class="datecal" hidden></div>
                </div>
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

        // Custom Monday-first date picker. The native <input type=date> picker takes its first-day-of-week
        // from the browser/OS locale, which a userscript can't change (it kept showing Sunday-first), so we
        // drive a calendar we render ourselves. The hidden <input type=date> above is still the canonical ISO
        // value store and still fires 'change' (→ openDefault), so the rest of the script is unchanged.
        const dateBtn  = panel.querySelector('.datebtn');
        const dateCal  = panel.querySelector('.datecal');
        const datewrap = panel.querySelector('.datewrap');
        const CAL_WD  = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];   // Monday-first, English
        const CAL_MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        const isoOfDate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const fmtDate = iso => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; }; // dd/mm/yyyy
        let calY, calM; // month currently shown in the popup
        const setDate = iso => { dateInput.value = iso; dateBtn.textContent = fmtDate(iso); dateInput.dispatchEvent(new Event('change')); };
        const closeCal = () => { dateCal.hidden = true; };
        const renderCal = () => {
            dateCal.textContent = '';
            const mkBtn = (txt, cls, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = cls; b.textContent = txt; b.addEventListener('click', e => { e.stopPropagation(); fn(); }); return b; };
            const head = document.createElement('div'); head.className = 'datecal-head';
            head.appendChild(mkBtn('‹', 'datecal-nav', () => { if (--calM < 0) { calM = 11; calY--; } renderCal(); }));
            const title = document.createElement('span'); title.className = 'datecal-title'; title.textContent = `${CAL_MON[calM]} ${calY}`;
            head.appendChild(title);
            head.appendChild(mkBtn('›', 'datecal-nav', () => { if (++calM > 11) { calM = 0; calY++; } renderCal(); }));
            dateCal.appendChild(head);
            const grid = document.createElement('div'); grid.className = 'datecal-grid';
            for (const w of CAL_WD) { const c = document.createElement('div'); c.className = 'datecal-wd'; c.textContent = w; grid.appendChild(c); }
            const first = new Date(calY, calM, 1);
            const start = new Date(calY, calM, 1 - ((first.getDay() + 6) % 7)); // back up to the Monday on/before the 1st
            const todayIso = todayISO(), selIso = dateInput.value;
            for (let i = 0; i < 42; i++) {
                const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
                const iso = isoOfDate(d);
                const cell = mkBtn(String(d.getDate()), 'datecal-day', () => { setDate(iso); closeCal(); });
                if (d.getMonth() !== calM) cell.classList.add('other');
                if (iso === todayIso) cell.classList.add('today');
                if (iso === selIso) cell.classList.add('sel');
                grid.appendChild(cell);
            }
            dateCal.appendChild(grid);
            const foot = document.createElement('div'); foot.className = 'datecal-foot';
            foot.appendChild(mkBtn('Today', 'datecal-today', () => { setDate(todayISO()); closeCal(); }));
            dateCal.appendChild(foot);
        };
        const openCal = () => {
            const iso = dateInput.value || todayISO();
            calY = +iso.slice(0, 4); calM = +iso.slice(5, 7) - 1;
            renderCal();
            dateCal.hidden = false;
            // Fixed popover anchored to the button — escapes the panel's overflow:hidden (which was clipping
            // the calendar). Clamp horizontally and flip above if it would overflow the viewport bottom.
            const r = dateBtn.getBoundingClientRect();
            const cw = dateCal.offsetWidth, ch = dateCal.offsetHeight;
            const left = Math.max(8, Math.min(r.left, window.innerWidth - cw - 8));
            let top = r.bottom + 6;
            if (top + ch > window.innerHeight - 8) top = Math.max(8, r.top - ch - 6);
            dateCal.style.left = left + 'px';
            dateCal.style.top = top + 'px';
        };
        dateBtn.addEventListener('click', e => { e.stopPropagation(); dateCal.hidden ? openCal() : closeCal(); });
        const onDocClick = e => { if (!document.contains(datewrap)) { document.removeEventListener('click', onDocClick); return; } if (!dateCal.hidden && !datewrap.contains(e.target)) closeCal(); };
        document.addEventListener('click', onDocClick); // close on outside click; self-removes when the panel is gone
        dateBtn.textContent = fmtDate(dateInput.value); // initial label

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
                // A sparse-click visit that opened a CONFIG SURFACE (edit/access/vnc action) is a sub-tool
                // config session: the work happens in a tool that logs almost no pang clicks and the save
                // commits a while after your last click. For those, widen the window tail so the session-
                // ending commit is caught (for BOTH the badge and the time credit); else keep the tight window.
                const hasConfigAction = (v.actions || []).some(a => { const m = ACTION_META[a]; return m && (m.cat === 'edit' || m.cat === 'access' || m.cat === 'vnc'); });
                const sparseConfig = (v.count || 0) <= SPARSE_CLICK_MAX && hasConfigAction;
                const start = v.first_ts - CHANGE_PAD_LEAD_MS;
                const end   = (v.last_ts || v.first_ts) + (sparseConfig ? COMMIT_SESSION_MAX_MS : CHANGE_PAD_TAIL_MS);
                const inWin = (commits[v.plant_id] || [])
                    .filter(c => { const t = tsFromPangDate(c.date); return t >= start && t <= end; })
                    .sort((a, b) => tsFromPangDate(a.date) - tsFromPangDate(b.date));
                // Badge + time use only CHANGE-TRIGGERED commits; scheduled snapshots (hourly/nightly/daily)
                // are noise that would otherwise inflate a long visit's 🔧 count and its time.
                const triggered = inWin.filter(c => !isScheduledCommit(c));
                v.window_commits = triggered;                              // commit objects, for the drawer
                v.changes_in_window = triggered.length;
                v.change_times = triggered.map(c => tsToLocalTime(tsFromPangDate(c.date)));
                v.scheduled_in_window = inWin.length - triggered.length;   // counted, not shown as a change
                // Time fusion — additive, bounded, idempotent (always recomputed from the click baseline, so
                // repeated re-renders never compound). For a sparse config session, credit the real active
                // span [first click → last triggered commit], clamped to [MIN, MAX], and lift estimated_minutes
                // to it when the click-only base is lower. Click-heavy plants never qualify, so addMs stays 0.
                const base = (v.base_minutes != null ? v.base_minutes : v.estimated_minutes) || 0;
                let addMs = 0;
                if (sparseConfig && triggered.length) {
                    const lastC = tsFromPangDate(triggered[triggered.length - 1].date);
                    const sessionMs = Math.min(Math.max(lastC - v.first_ts, COMMIT_SESSION_MIN_MS), COMMIT_SESSION_MAX_MS);
                    addMs = Math.max(0, sessionMs - base * 60000);
                }
                v.estimated_minutes = base + Math.round(addMs / 60000);
                v.commit_added_minutes = v.estimated_minutes - base;      // for the tooltip / verification dump
                if (triggered.length || v.commit_added_minutes) any = true;
            }
            if (any) applyAndRender(); // repaint with badges + fused time
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
            base_minutes: (v.base_minutes != null ? v.base_minutes : v.estimated_minutes), // click-only floor (never the commit-topped value)
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

        // Quick (recent-only) scan found nothing. The visit is very likely on a plant you didn't open
        // in pang (plant-admin/designer), which only a Full scan covers — so offer that prominently
        // instead of a dead-end "no data".
        const renderQuickEmpty = () => {
            const recent = (GM_getValue(KEY_KNOWN_PLANTS, []) || []).map(String);
            const mine = (GM_getValue(KEY_USER_PLANTS, {})[effectiveUsername()] || []).map(String);
            const knownN = new Set([...recent, ...mine]).size;
            list.innerHTML = `
                <div class="warn">
                    <strong>No data for ${isoToNorwegianDate(dateInput.value)}</strong>
                    <p>Nothing among your ~${knownN} recent + previously-visited plants. If you worked on a brand-new plant (not opened in pang, e.g. via plant-admin/designer), it's only found by a full scan.</p>
                    <div><button data-action="run-full">🔍 Run Full scan (all plants)</button></div>
                </div>`;
            list.querySelector('[data-action=run-full]').addEventListener('click', () => doScan('full'));
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
                // Make sure we have your login + recent list, harvested cross-protocol.
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
                const onProg = (done, total) => { if (seq === scanSeq) progress.style.width = Math.round(done / total * 100) + '%'; }; // a superseded scan must stop moving the bar
                let visits, username, scanned;
                if (mode === 'full') {
                    // A full scan already pulls every plant's complete history, so extract the user's
                    // visits for EVERY date in one pass and cache them all — browsing any of those dates
                    // (e.g. the rest of the month) is then instant. Then display the selected date.
                    const all = await loadUserHistoryAllDates(plantIds, iso, onProg);
                    if (seq !== scanSeq) return;
                    username = all.username; scanned = all.scanned;
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
                    visits = r.visits; username = r.username; scanned = r.scanned;
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
                if (visits.length === 0 && mode === 'quick') {
                    // Quick scope is partial (recent plants only) → nudge toward a Full scan, since your
                    // visit may be on a brand-new plant you didn't open in pang.
                    renderQuickEmpty();
                } else {
                    // Full/refresh already covered everything (or there are visits) → render normally;
                    // an empty result shows the "No data for <date>" message in renderVisits.
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
            // A date change supersedes any running scan. The superseded scan's finally is seq-guarded out and
            // the cached path never scans, so reset the scan UI here or a stale bar / disabled buttons stick.
            progress.style.width = '0%';
            searchBtn.disabled = fullscanBtn.disabled = resyncBtn.disabled = false;
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
            `<span class="act act-${c.cat}" title="${escapeHtml(c.code)}"><span class="dot"></span>${escapeHtml(c.label)}</span>`
        ).join('');
    }

    function renderVisits(list, visits, isoDate, scanned) {
        list.innerHTML = '';
        if (scanned === 0) {
            list.innerHTML = `<div class="empty">No plants known yet. Open <a href="${pangBase()}/pang.qxs" target="_blank">pang</a> once so the script can pick up your recent plants.</div>`;
            return;
        }
        if (visits.length === 0) {
            list.innerHTML = `<div class="empty">No data for ${isoToNorwegianDate(isoDate)}.<br><small>Nothing logged across ${scanned} known plant${scanned === 1 ? '' : 's'}.</small></div>`;
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
            const configNote = v.commit_added_minutes > 0
                ? ` Includes +${fmtMinutes(v.commit_added_minutes)} credited from config work — few clicks logged but a real config change was committed in this window.`
                : '';
            const tooltip = v.normalized_minutes != null
                ? `Distributed share of your workday total. Raw estimate ≈ ${fmtMinutes(v.estimated_minutes || 0)}.${configNote}`
                : `Estimated from your clicks: time on each plant counts until you click elsewhere, and any pause over 30 min counts as a break, not work. Approximation only — pang logs clicks, not active time.${configNote}`;
            const estimate = shown
                ? `<div class="estimate" title="${escapeHtml(tooltip)}">${prefix}${fmtMinutes(shown)}</div>`
                : '';
            const nChg = v.changes_in_window || 0;
            const chgTip = nChg > 0
                ? `A config snapshot was committed at ${(v.change_times || []).join(', ')} during your active window. These are automatic system snapshots with no author recorded — they show what the plant config changed to around your visit, not necessarily changes you personally made. Click to see what changed.`
                : '';
            const chgBadge = nChg > 0
                ? ` <span class="chg" role="button" tabindex="0" aria-expanded="false" title="${escapeHtml(chgTip)}">🔧 ${nChg} change${nChg === 1 ? '' : 's'} <span class="chg-car">▸</span></span>`
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
                ${nChg > 0 ? '<div class="chg-detail" hidden></div>' : ''}
            `;
            list.appendChild(div);
            if (nChg > 0 && Array.isArray(v.window_commits) && v.window_commits.length) {
                const badge = div.querySelector('.chg');
                const detail = div.querySelector('.chg-detail');
                const car = badge && badge.querySelector('.chg-car');
                v._chgUI = v._chgUI || { open: false, sec: {} }; // persisted on the visit → survives applyAndRender
                const openDrawer = async () => {
                    detail.hidden = false; badge.setAttribute('aria-expanded', 'true'); if (car) car.textContent = '▾';
                    v._chgUI.open = true;
                    if (detail.dataset.loaded) return;                       // rendered once; re-expand is instant
                    detail.textContent = 'Reading config snapshots…';
                    let model = null;
                    try { model = await loadChangeDetail(v); } catch (e) { model = null; }
                    if (!document.contains(detail)) return;                  // row was re-rendered while loading — stale
                    if (!model) { detail.textContent = ''; const er = document.createElement('div'); er.className = 'chg-foot'; er.textContent = "Couldn't load details — open the plant in pang"; detail.appendChild(er); return; }
                    renderChangeDetail(detail, model, v._chgUI);             // pass UI state so sections restore expand/reveal
                    detail.dataset.loaded = '1';
                };
                const closeDrawer = () => { detail.hidden = true; badge.setAttribute('aria-expanded', 'false'); if (car) car.textContent = '▸'; v._chgUI.open = false; };
                const toggle = () => { (badge.getAttribute('aria-expanded') === 'true') ? closeDrawer() : openDrawer(); };
                if (badge) {
                    badge.addEventListener('click', toggle);
                    badge.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
                }
                if (v._chgUI.open) openDrawer(); // re-render (normalize/workday toggle…) → restore the drawer to where you left it
            }
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