// ==UserScript==
// @name         Rocketlane Day Recap
// @version      4.108
// @description  On Rocketlane My Timesheet, pick a date and see all IWMAC plants you visited that day, plus a 🔧 badge when the plant's config changed during your visit, and a 📋 "Day by category" timesheet roll-up. Uses pang's get_history + changes/commits APIs.
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
    const KEY_PANEL_POS    = 'panel_pos';      // { left, top } — where the user dragged the panel; null = default bottom-right
    const SCRIPT_VERSION   = '4.108';
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
    const ISOLATED_TOUCH_CAP = 8;         // minutes: a single config-surface click (pma/sys) with no commit is a quick check, not 30 min of work
    // Long-silence damping (v4.56). A 39-day corpus (1,043 clicks) showed 40% of all raw credit was
    // capped 30-min blocks, and for silences > 45 min only ~4 in 10 had a config commit proving work
    // continued — the rest are far more likely breaks/meetings than half an hour of plant work. So a
    // capped gap longer than LONGGAP_MS keeps its full 30 only when a change-triggered commit for THAT
    // plant lands within LONGGAP_EVIDENCE_MS of the silence starting; otherwise it's re-credited at
    // LONGGAP_CREDIT_MIN. Validated: the visually-approved 26/05 + 12/06 days are bit-identical.
    const LONGGAP_MS          = 45 * 60 * 1000; // a silence after a click longer than this is a "long gap"
    const LONGGAP_EVIDENCE_MS = 60 * 60 * 1000; // commit within this of the gap start = proof work continued
    const LONGGAP_CREDIT_MIN  = 15;             // minutes an unevidenced long gap keeps (instead of the 30 cap)
    // ---- Config-change ("commits") overlay: changes.qxs / services/changes/commits.php ----
    // A plant's config snapshots are logged as commits {date, username:":system:", ...} — ALL
    // automatic (no human author), so we can't say WHO changed a plant. But a commit landing inside
    // your active window on a plant is strong evidence real config work happened there (vs a plant you
    // only clicked through). Pad the window a touch (saves often commit a few min after the last click)
    // and ignore commits outside it (e.g. nightly auto-snapshots).
    const CHANGE_PAD_LEAD_MS = 2 * 60 * 1000; // count commits from 2 min before your first action…
    const CHANGE_PAD_TAIL_MS = 20 * 60 * 1000; // …through 20 min after your last click. Measured (285 triggered
    // commits near real visits, 2026-07-02): save→commit lag is 0-2 min for only ~36%; ~31% land 7-20 min after
    // the nearest click, and 13 click-heavy visits in 3 months ended with a save 7-20 min after the last click —
    // the old 6-min pad missed all of those (no 🔧 badge, no drawer, no Integration evidence). Deliberately equal
    // to COMMIT_SESSION_MAX_MS so sparse and click-heavy visits share the same commit-attribution window.
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
    const WEEK_ID     = 'rl-recap-week';     // ⤴ Book week floating modal
    const WEEK_BTN_ID = 'rl-book-week-btn';  // toolbar button injected left of Rocketlane's "Add"
    const PARALLEL = 8;
    const SCAN_PARALLEL = 20;  // concurrent get_history requests — same server concurrency whether batched or not
    const HISTORY_BATCH_MAX = 10; // max plant_ids per batched get_history request. v4.85 measurement: the server
                                  // SERIALIZES a batch, so big batches head-of-line-block the ~6 browser connections;
                                  // batch 10 × 20 workers ran the same sample 1.6× faster than 30 × 20 (434 vs 710 ms/120 plants)
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
        // so newly added plants get into the cache without a manual Refresh.
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
    // round-trip per plant. Returns { plant_id: entries[] }, or NULL on a transport/parse failure so
    // callers can retry — resolving {} on failure used to drop the whole batch silently, and a full
    // scan then cached that hole as authoritative for every date. There's no server-side date/user
    // filter, so each plant still returns its full history — we filter client-side.
    // (Measured 2026-07-02: ~3-6 ms/plant server-side, ~45 KB/plant, no gzip — a full scan is
    // bandwidth/parse-bound at ~300 MB, and the browser caps HTTP/1.1 at ~6 connections per origin,
    // so SCAN_PARALLEL/HISTORY_BATCH_MAX are already at the effective ceiling.)
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
                    try {
                        const parsed = JSON.parse(r.responseText);
                        // pang returns an array for multi-request batches, but a single object for a
                        // 1-request batch — normalise to a list and map by echoed id (positional fallback).
                        const list = Array.isArray(parsed) ? parsed : [parsed];
                        const out = {};
                        for (let k = 0; k < list.length; k++) {
                            const item = list[k];
                            const idx = (typeof item?.id === 'number') ? item.id : k;
                            const pid = plantIds[idx];
                            if (pid != null) out[pid] = Array.isArray(item?.result) ? item.result : [];
                        }
                        resolve(out);
                    } catch { resolve(null); }
                },
                onerror:   () => resolve(null),
                ontimeout: () => resolve(null),
            });
        });
    }

    // One retry on transport failure; a batch that still fails is reported (not silently dropped).
    async function fetchHistoryBatchReliable(batch, onFail) {
        let hist = await gmFetchHistoryBatch(batch);
        if (!hist) hist = await gmFetchHistoryBatch(batch);
        if (!hist) { onFail?.(batch.length); return {}; }
        return hist;
    }

    // Same shape as gmFetchHistoryBatch, but for the config-change log behind changes.qxs:
    // POST /services/changes/commits.php, method get_commits. Returns { plant_id: commits[] }, each
    // commit { id, date, username, address } (username is always ":system:" — automatic snapshots).
    // Same server as actions.php, so apiOrigin()'s http-first choice applies (GM_xmlhttpRequest can't
    // use the internal https cert). Like get_history there's no server-side date filter — each plant
    // returns its full commit history, which we filter to the visit window client-side.
    // v4.85 deep-dive findings: commits.php SERIALIZES a JSON-RPC batch server-side — a cold 7-plant
    // batch measured 2.9 s while the same plants as parallel SINGLE requests took 0.9 s (3.2×). And a
    // plant's commit list covers EVERY date, yet it was refetched on each date view. So: per-plant
    // session cache (TTL 10 min — today's list grows while you work) + misses fetched as single
    // requests through a small pool.
    const _commitsCache = new Map(); // plant_id -> { ts, list }
    const COMMITS_CACHE_TTL_MS = 10 * 60 * 1000;
    function gmFetchCommitsOne(base, pid) {
        return new Promise(resolve => {
            GM_xmlhttpRequest({
                method: 'POST',
                url: base + '/services/changes/commits.php',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                data: JSON.stringify([{ jsonrpc: '2.0', method: 'get_commits', params: { plant_id: String(pid) }, id: 0 }]),
                timeout: 60000,
                onload: r => {
                    let list = [];
                    try { const p = JSON.parse(r.responseText); const res = Array.isArray(p) ? p[0] : p; if (Array.isArray(res?.result)) list = res.result; } catch {}
                    resolve(list);
                },
                onerror: () => resolve(null), ontimeout: () => resolve(null),
            });
        });
    }
    async function gmFetchCommitsBatch(plantIds) {
        const base = await apiOrigin();
        const out = {};
        const now = Date.now();
        const misses = [];
        for (const pid of plantIds.map(String)) {
            const c = _commitsCache.get(pid);
            if (c && (now - c.ts) < COMMITS_CACHE_TTL_MS) out[pid] = c.list;
            else misses.push(pid);
        }
        let idx = 0;
        const worker = async () => {
            while (idx < misses.length) {
                const pid = misses[idx++];
                const list = await gmFetchCommitsOne(base, pid);
                if (list !== null) { out[pid] = list; _commitsCache.set(pid, { ts: Date.now(), list }); }
                else out[pid] = (_commitsCache.get(pid) || {}).list || []; // network miss → stale cache or empty
            }
        };
        const pool = []; for (let k = 0; k < Math.min(8, misses.length); k++) pool.push(worker());
        await Promise.all(pool);
        return out;
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

    // A commit's table content is IMMUTABLE — cache every fetched (table, commit) for the session, so
    // plan rebuilds and drawer opens across dates never refetch the same diff data (v4.85).
    const _twoVerCache = new Map(); // `${table}|${commit}` -> result
    async function gmFetchTwoVersionsBatch(jobs) {
        const base = await apiOrigin();
        const out = new Array(jobs.length).fill(null);
        const missIdx = [];
        for (let i = 0; i < jobs.length; i++) {
            const key = jobs[i].table_name + '|' + jobs[i].commit;
            if (_twoVerCache.has(key)) out[i] = _twoVerCache.get(key);
            else missIdx.push(i);
        }
        if (!missIdx.length) return out;
        await new Promise(resolve => {
            const reqs = missIdx.map((mi, i) => ({ jsonrpc: '2.0', method: 'get_two_versions', params: { table_name: jobs[mi].table_name, commit: String(jobs[mi].commit) }, id: i }));
            GM_xmlhttpRequest({
                method: 'POST', url: base + '/services/changes/data.php',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, data: JSON.stringify(reqs), timeout: 60000,
                onload: r => {
                    try {
                        const parsed = JSON.parse(r.responseText);
                        const list = Array.isArray(parsed) ? parsed : [parsed];
                        for (let k = 0; k < list.length; k++) {
                            const item = list[k];
                            const idx = (typeof item?.id === 'number') ? item.id : k;
                            if (idx >= 0 && idx < missIdx.length) {
                                const mi = missIdx[idx];
                                const res = (item && item.result) ? item.result : null;
                                out[mi] = res;
                                if (res) _twoVerCache.set(jobs[mi].table_name + '|' + jobs[mi].commit, res);
                            }
                        }
                    } catch {}
                    resolve();
                },
                onerror: () => resolve(), ontimeout: () => resolve(),
            });
        });
        return out;
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

        let donePlants = 0, foundCount = 0, failedPlants = 0;
        const perBatch = await pMap(batches, async (batch) => {
            const histByPlant = await fetchHistoryBatchReliable(batch, n => { failedPlants += n; });
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
                    action_counts: matches.reduce((o, m) => (o[m.action] = (o[m.action] || 0) + 1, o), {}),
                    count: matches.length,
                    _events: matches.map(m => ({ ts: tsFromPangDate(m.date), action: m.action })),
                });
            }
            donePlants += batch.length;
            foundCount += found.length;
            onProgress?.(donePlants, plantIds.length, foundCount);
            return found;
        }, SCAN_PARALLEL);

        const visits = perBatch.flat().sort((a, b) => a.first_ts - b.first_ts);

        // Cross-plant time attribution: flatten every action timestamp into one timeline,
        // then credit each gap (capped at ACTIVE_CAP_MS) to the plant that was open across it.
        const allEvents = [];
        for (const v of visits) {
            for (const e of v._events) allEvents.push({ plant_id: v.plant_id, ts: e.ts, action: e.action });
        }
        const { minutes: minsByPlant, cappedGaps } = attributeTime(allEvents);
        const draw = designerGapByPlant(allEvents);
        for (const v of visits) {
            v.estimated_minutes = minsByPlant[v.plant_id] || 0;
            v.base_minutes = v.estimated_minutes; // immutable click-only floor; commit fusion adds on top in ensureChangesEnriched
            v.designer_minutes = draw.minutes[v.plant_id] || 0;      // gap-after-Designer = real Drawing time (v4.54)
            v.designer_last = draw.lastSession[v.plant_id] || null;  // last designer session {s,e} — commit-extendable (v4.60)
            v.capped_gaps = cappedGaps[v.plant_id] || [];            // long silences, re-judged against commits (v4.56)
            delete v._events;
        }

        return { visits, username, scanned: plantIds.length, usersOnDate: [...usersOnDate.values()], failed: failedPlants };
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
        let donePlants = 0, failedPlants = 0;
        await pMap(batches, async (batch) => {
            const histByPlant = await fetchHistoryBatchReliable(batch, n => { failedPlants += n; });
            // (no await below — safe to mutate the shared maps directly)
            for (const pid of batch) {
                for (const e of (histByPlant[pid] || [])) {
                    const iso = pangDateToISODate(e.date);
                    const nu = normalizeUser(e.user);
                    if (iso === selectedIso && nu && !usersOnSelected.has(nu)) usersOnSelected.set(nu, e.user);
                    if (nu !== username) continue;
                    let pm = byDate.get(iso); if (!pm) { pm = new Map(); byDate.set(iso, pm); }
                    let rec = pm.get(pid); if (!rec) { rec = { actions: new Set(), counts: {}, ev: [] }; pm.set(pid, rec); }
                    rec.actions.add(e.action); rec.counts[e.action] = (rec.counts[e.action] || 0) + 1; rec.ev.push({ t: tsFromPangDate(e.date), a: e.action });
                }
            }
            donePlants += batch.length;
            onProgress?.(donePlants, plantIds.length, (byDate.get(selectedIso) || { size: 0 }).size);
        }, SCAN_PARALLEL);
        const dates = {};
        for (const [iso, pm] of byDate) {
            const visits = [];
            const events = [];
            for (const [pid, rec] of pm) {
                const ev = rec.ev.sort((a, b) => a.t - b.t);
                const ts = ev.map(e => e.t);
                for (const e of ev) events.push({ plant_id: pid, ts: e.t, action: e.a });
                visits.push({ plant_id: pid, name: cachedPlantName(names, pid), first_ts: ts[0], last_ts: ts[ts.length - 1], actions: [...rec.actions], action_counts: rec.counts, count: ev.length });
            }
            const { minutes: mins, cappedGaps } = attributeTime(events);
            const draw = designerGapByPlant(events);
            for (const v of visits) { v.estimated_minutes = mins[v.plant_id] || 0; v.base_minutes = v.estimated_minutes; v.designer_minutes = draw.minutes[v.plant_id] || 0; v.designer_last = draw.lastSession[v.plant_id] || null; v.capped_gaps = cappedGaps[v.plant_id] || []; }
            visits.sort((a, b) => a.first_ts - b.first_ts);
            dates[iso] = visits;
        }
        return { dates, usersOnSelected: [...usersOnSelected.values()], username, scanned: plantIds.length, failed: failedPlants };
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
        const minutes = {}, cappedGaps = {};
        if (!events || events.length === 0) return { minutes, cappedGaps };
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
            minutes[cur.plant_id] = (minutes[cur.plant_id] || 0) + credit;
            // Record capped gaps so enrichment can later re-judge long silences against commit
            // evidence (LONGGAP damping) — the cap credit is provisional for those.
            if (gap > ACTIVE_CAP_MS) (cappedGaps[cur.plant_id] = cappedGaps[cur.plant_id] || []).push({ ts: cur.ts, gap });
        }
        // Convert ms → rounded minutes
        for (const id of Object.keys(minutes)) minutes[id] = Math.max(1, Math.round(minutes[id] / 60000));
        return { minutes, cappedGaps };
    }

    const DESIGNER_BURST_MS = 2 * 60 * 1000; // a same-plant click reached within this of the previous = a momentary
                                             // pop-out inside a designer session (glance at pma/VNC, back to drawing)
    // Drawing minutes per plant = the graphic-designer SESSION each Designer click opens. The designer logs one
    // pang click then runs click-free, so the session runs from the Designer click until you LEAVE the plant —
    // BRIDGING a tight burst of quick same-plant clicks (a momentary pop-out), but STOPPING at a sustained pause
    // (gap > DESIGNER_BURST_MS between same-plant clicks = you moved to other work) or a plant switch. Capped at
    // ACTIVE_CAP_MS per session. Same cross-plant timeline as attributeTime. (v4.55; v4.54 was the immediate gap only.)
    function designerGapByPlant(events) {
        const minutes = {}, lastSession = {};
        if (!events || !events.length) return { minutes, lastSession };
        const sorted = [...events].sort((a, b) => (a.ts - b.ts) || String(a.plant_id).localeCompare(String(b.plant_id)));
        for (let i = 0; i < sorted.length; i++) {
            if (!CAT_DESIGNER_ACTIONS.has(sorted[i].action)) continue;
            const plant = sorted[i].plant_id, start = sorted[i].ts;
            let j = i, endTs;
            while (true) {
                const next = sorted[j + 1];
                if (!next) { endTs = sorted[j].ts + TAIL_MS; break; }                                         // day ended on this plant
                if (next.plant_id !== plant) { endTs = next.ts; break; }                                      // left the plant → drawing until you left
                if (j > i && (next.ts - sorted[j].ts) > DESIGNER_BURST_MS) { endTs = sorted[j].ts; break; }    // sustained pause → moved to other work
                j++;                                                                                          // designer's own gap, or a quick pop-out → bridge
            }
            minutes[plant] = (minutes[plant] || 0) + Math.min(Math.max(0, endTs - start), ACTIVE_CAP_MS);
            lastSession[plant] = { s: start, e: Math.min(endTs, start + ACTIVE_CAP_MS) }; // last session wins — enrichment may extend it to a commit
            if (j > i) i = j; // skip the rest of this session so overlapping designer clicks aren't double-counted
        }
        for (const id of Object.keys(minutes)) minutes[id] = Math.round(minutes[id] / 60000);
        return { minutes, lastSession };
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
            cursor: move; user-select: none; touch-action: none;
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
        #${PANEL_ID} .datecal .datecal-nav { width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; padding: 0; min-width: 0; background: none; border: none; border-radius: 50%; color: #0f62fe; font-size: 18px; line-height: 1; cursor: pointer; }
        #${PANEL_ID} .datecal .datecal-nav:hover { background: #edf2ff; }
        #${PANEL_ID} .datecal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
        #${PANEL_ID} .datecal-wd { text-align: center; font-size: 10px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: #a8a8a8; padding-bottom: 4px; }
        #${PANEL_ID} .datecal .datecal-day { aspect-ratio: 1; display: flex; align-items: center; justify-content: center; padding: 0; min-width: 0; border: none; background: none; font-size: 12.5px; color: #21272a; font-weight: 500; cursor: pointer; border-radius: 50%; transition: background .12s, color .12s; }
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
        #${PANEL_ID} .scan-live { margin-top: 6px; font-size: 11px; color: #8d8d8d; }
        #${PANEL_ID} .total {
            padding: 8px 14px; background: #f4f4f4; border-top: 1px solid #e0e0e0;
            font-size: 12px; color: #525252; display: flex; justify-content: space-between;
        }
        #${PANEL_ID} .progress { height: 3px; background: #e0e0e0; }
        #${PANEL_ID} .progress > div { height: 100%; background: #0f62fe; transition: width .15s; }
        #${PANEL_ID} .catsum:empty { display: none; }
        #${PANEL_ID} .catsum { padding: 8px 14px 10px; background: #f9fbff; border-bottom: 1px solid #e8eef9; }
        #${PANEL_ID} .catsum-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
        #${PANEL_ID} .catsum-title { font-size: 12px; font-weight: 600; color: #21272a; }
        #${PANEL_ID} .catsum-q { color: #a8a8a8; cursor: help; font-weight: 400; }
        #${PANEL_ID} .catsum-btns { display: inline-flex; gap: 6px; }
        #${PANEL_ID} .catsum-copy { font-size: 11px; padding: 2px 8px; border: 1px solid #c6c6c6; border-radius: 5px; background: #fff; color: #0f62fe; cursor: pointer; }
        #${PANEL_ID} .catsum-copy:hover { border-color: #0f62fe; }
        #${PANEL_ID} .catsum-book { font-size: 11px; padding: 2px 8px; border: 1px solid #0f62fe; border-radius: 5px; background: #0f62fe; color: #fff; font-weight: 600; cursor: pointer; }
        #${PANEL_ID} .catsum-book:hover { background: #0353e9; }
        :is(#${PANEL_ID}, #${WEEK_ID}) .bookplan { font-size: 12px; color: #21272a; max-height: 46vh; overflow-y: auto; overscroll-behavior: contain; }
        :is(#${PANEL_ID}, #${WEEK_ID}) .bookplan-head { font-weight: 600; margin-bottom: 6px; position: sticky; top: 0; z-index: 1; background: #f9fbff; padding: 2px 0 6px; }
        :is(#${PANEL_ID}, #${WEEK_ID}) .bookplan-row { display: flex; gap: 7px; align-items: flex-start; padding: 4px 0; border-top: 1px solid #eef1f6; }
        :is(#${PANEL_ID}, #${WEEK_ID}) .bookplan-st { flex: none; width: 18px; text-align: center; }
        :is(#${PANEL_ID}, #${WEEK_ID}) .bookplan-cb { width: 14px; height: 14px; margin: 1px 0 0; accent-color: #0f62fe; cursor: pointer; }
        :is(#${PANEL_ID}, #${WEEK_ID}) .bookplan-proj { font-size: 11px; max-width: 190px; padding: 1px 2px; border: 1px solid #c6c6c6; border-radius: 4px; background: #fff; color: #21272a; }
        :is(#${PANEL_ID}, #${WEEK_ID}) .bookplan-txt { flex: 1; line-height: 1.35; }
        :is(#${PANEL_ID}, #${WEEK_ID}) .bookplan-txt small { color: #6f6f6f; }
        :is(#${PANEL_ID}, #${WEEK_ID}) .bookplan-warn { font-size: 11px; color: #b1520a; background: #fff4e5; border: 1px solid #f0d6b0; border-radius: 6px; padding: 5px 8px; margin: 4px 0 6px; }
        :is(#${PANEL_ID}, #${WEEK_ID}) .bookplan-foot { margin-top: 8px; display: flex; gap: 8px; align-items: center; position: sticky; bottom: 0; background: #f9fbff; padding: 8px 0 2px; }
        :is(#${PANEL_ID}, #${WEEK_ID}) .bookplan-foot button { font-size: 12px; padding: 4px 10px; border-radius: 6px; border: 1px solid #c6c6c6; background: #fff; cursor: pointer; }
        :is(#${PANEL_ID}, #${WEEK_ID}) .bookplan-foot button[data-b=go] { background: #0f62fe; border-color: #0f62fe; color: #fff; font-weight: 600; }
        :is(#${PANEL_ID}, #${WEEK_ID}) .bookplan-foot button[disabled] { opacity: .5; cursor: default; }
        :is(#${PANEL_ID}, #${WEEK_ID}) .bookplan-sum { font-size: 12px; color: #24a148; font-weight: 600; flex: 1; }
        #${WEEK_ID} { position: fixed; top: 64px; right: 24px; width: 480px; max-width: calc(100vw - 40px); background: #f9fbff; border: 1px solid #d0d7e2; border-radius: 10px; box-shadow: 0 10px 30px rgba(16,24,40,.22); z-index: 2147483000; padding: 12px 14px; color: #21272a; font-family: inherit; }
        #${WEEK_ID} .bookplan { max-height: 68vh; }
        #${WEEK_ID} .rl-week-day { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; font-weight: 700; font-size: 12px; color: #0043ce; margin-top: 8px; padding: 6px 0 2px; border-top: 2px solid #dfe6f2; }
        #${WEEK_ID} .rl-week-day small { color: #6f6f6f; font-weight: 500; text-align: right; }
        #${WEEK_ID} .rl-week-status { font-size: 12px; color: #525252; padding: 8px 0; }
        #${WEEK_ID} .rl-week-nav { float: right; display: inline-flex; gap: 4px; }
        #${WEEK_ID} .rl-week-nav button { font-size: 13px; line-height: 1.4; padding: 0 8px; border: 1px solid #c6c6c6; background: #fff; border-radius: 5px; cursor: pointer; }
        #${WEEK_BTN_ID} { white-space: nowrap; }
        #${PANEL_ID} .catsum-row { display: flex; align-items: center; gap: 8px; margin: 3px 0; font-size: 12px; color: #21272a; }
        #${PANEL_ID} .catsum-name { display: inline-flex; align-items: center; gap: 6px; width: 160px; flex: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        #${PANEL_ID} .catsum-dot { width: 9px; height: 9px; border-radius: 50%; flex: none; }
        #${PANEL_ID} .catsum-bar { flex: 1; height: 7px; background: #eaeef5; border-radius: 4px; overflow: hidden; }
        #${PANEL_ID} .catsum-bar > span { display: block; height: 100%; border-radius: 4px; }
        #${PANEL_ID} .catsum-h { width: 46px; flex: none; text-align: right; font-weight: 600; color: #161616; }
        #${PANEL_ID} .catsum-foot { margin-top: 6px; font-size: 11px; color: #8d8d8d; }
        #${PANEL_ID} .catrow:empty { display: none; }
        #${PANEL_ID} .catrow { margin-top: 4px; display: flex; flex-wrap: wrap; gap: 3px 10px; }
        #${PANEL_ID} .catchip { display: inline-flex; align-items: center; gap: 4px; font-size: 10.5px; color: #6f6f6f; white-space: nowrap; }
        #${PANEL_ID} .catchip-dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
        #${PANEL_ID} .catchip b { color: #21272a; font-weight: 600; }
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
                <button data-action="search" title="Re-scan the selected date (your recent + previously-visited plants) and refresh its cache">Refresh</button>
            </div>
            <div class="controls" style="border-top: 1px solid #f0f0f0; padding-top: 6px;">
                <button data-action="fullscan" title="Scans ALL ~7,600 IWMAC plants so visits made via plant-admin/designer are found too. Slow (~1 min) and briefly opens pang; the result is cached per date.">🔍 Full scan</button>
                <span style="font-size: 11px; color: #6f6f6f; flex: 1; line-height: 1.3;">Refresh = your recent + previously-visited plants (fast). Full scan = all ~7,600 plants (~1 min, cached).</span>
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
            <div class="catsum"></div>
            <div class="results"></div>
            <div class="total"></div>
        `;
        document.body.appendChild(panel);

        const dateInput     = panel.querySelector('input[type=date]');
        const searchBtn     = panel.querySelector('[data-action=search]'); // labelled "Refresh" — re-scans the selected date
        const fullscanBtn   = panel.querySelector('[data-action=fullscan]');
        const workdayInput  = panel.querySelector('[data-field=workday]');
        const normalizeChk  = panel.querySelector('[data-field=normalize]');
        const list          = panel.querySelector('.results');
        const catsumEl      = panel.querySelector('.catsum');
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
        let lastFailed = 0;         // plants unreachable in the shown scan (after retry) — result not cached
        let scanSeq = 0;       // bumped on every scan / date-change; a run only renders if it's still the latest

        const applyAndRender = () => {
            if (!lastVisits) return;
            const useNorm = !!normalizeChk.checked;
            const hours = parseFloat(workdayInput.value);
            const targetMin = (useNorm && isFinite(hours) && hours > 0) ? Math.round(hours * 60) : 0;
            // Reset any previous normalized values, then re-apply if asked
            for (const v of lastVisits) v.normalized_minutes = null;
            // Distribute the workday total over BOOKABLE visits only — Quick-check visits are excluded from the
            // timesheet, so they must not absorb a slice of the target and carry it into the not-booked bucket
            // (which left "to book" below the configured hours). Quick visits keep their raw estimate. (v4.53, R2)
            if (targetMin > 0) normalizeMinutes(lastVisits.filter(v => categorizeVisit(v)[CAT_CHECK] == null), targetMin, ROUND_TO_MIN);
            renderVisits(list, lastVisits, lastIso, lastScanned);
            renderCategorySummary(catsumEl, lastVisits, lastIso);
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
                `<span>${lastVisits.length} plant${lastVisits.length === 1 ? '' : 's'} of ${lastScanned} scanned${lastFailed ? ` · ⚠ ${lastFailed} unreachable — not cached` : ''}${stillMissing ? ` · ${stillMissing} unnamed` : ''}${totalLabel}</span>`;
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
            // Core moved to top-level enrichVisitsWithCommits (v4.93) so ⤴ Book week can enrich any
            // day's visits without the panel; this wrapper only keeps the stale-view guards + repaint.
            const any = await enrichVisitsWithCommits(visits, lastIso);
            if (seq !== scanSeq || visits !== lastVisits) return; // a newer view is showing
            if (any) applyAndRender(); // repaint with badges + fused time + category summary
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

        // ----- Full-scan result cache: cacheVisit/readCache/writeCacheDates are TOP-LEVEL now
        // (v4.101) — ⤴ Book week runs its own full scan without the panel being open.

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
                if (mode === 'full') {
                    // Footprint-first: scan the plants you're most likely on first, so the live "found"
                    // counter fills within seconds. Pure reordering — the result is identical.
                    const pri = new Set([
                        ...((GM_getValue(KEY_KNOWN_PLANTS, []) || []).map(String)),
                        ...(((GM_getValue(KEY_USER_PLANTS, {})[effectiveUsername()]) || []).map(String)),
                    ]);
                    const head = [], tail = [];
                    for (const id of plantIds.map(String)) (pri.has(id) ? head : tail).push(id);
                    plantIds = [...head, ...tail];
                }
                list.innerHTML = `<div class="empty">Querying pang across ${plantIds.length} plant${plantIds.length === 1 ? '' : 's'}…${mode === 'full' ? '<br><small>full scan — about a minute; caches the whole period</small>' : ''}<div class="scan-live"></div></div>`;
                const liveEl = list.querySelector('.scan-live');
                const iso = dateInput.value;
                const onProg = (done, total, foundSel) => { // a superseded scan must stop moving the bar
                    if (seq !== scanSeq) return;
                    progress.style.width = Math.round(done / total * 100) + '%';
                    if (liveEl) liveEl.textContent = `${done} of ${total} plants scanned` + (foundSel ? ` · ${foundSel} plant${foundSel === 1 ? '' : 's'} found for ${isoToNorwegianDate(iso)}` : '');
                };
                let visits, username, scanned;
                if (mode === 'full') {
                    // A full scan already pulls every plant's complete history, so extract the user's
                    // visits for EVERY date in one pass and cache them all — browsing any of those dates
                    // (e.g. the rest of the month) is then instant. Then display the selected date.
                    const all = await loadUserHistoryAllDates(plantIds, iso, onProg);
                    if (seq !== scanSeq) return;
                    username = all.username; scanned = all.scanned;
                    visits = all.dates[iso] || [];
                    lastFailed = all.failed || 0;
                    if (username) {
                        // Don't cache a partial scan as authoritative — a batch that failed (even after
                        // retry) would otherwise leave a silent hole in EVERY cached date until the next
                        // full scan. The footer warns instead, so you know to re-run.
                        if (!lastFailed) writeCacheDates(username, all.dates, scanned); // cache every date this scan found
                        const fp = new Set();
                        for (const d in all.dates) for (const v of all.dates[d]) fp.add(v.plant_id);
                        rememberUserPlants(username, [...fp].map(id => ({ plant_id: id })));
                    }
                } else {
                    const r = await loadVisitsForDate(iso, plantIds, onProg);
                    if (seq !== scanSeq) return;
                    visits = r.visits; username = r.username; scanned = r.scanned;
                    lastFailed = r.failed || 0;
                    rememberUserPlants(username, visits);
                    if (mode === 'refresh' && username && !lastFailed) writeCacheDates(username, { [iso]: visits }, scanned); // Refresh updates only this date
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
            searchBtn.disabled = fullscanBtn.disabled = false;
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
                lastFailed    = 0; // cache is only written by complete scans
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

        searchBtn.addEventListener('click', () => doScan('refresh')); // "Refresh": re-scan the selected date (recent + footprint) and update its cache
        fullscanBtn.addEventListener('click', fullScanWithWarning);
        dateInput.addEventListener('change', openDefault);
        panel.querySelector('[data-action=close]').addEventListener('click', () => panel.remove());

        // ---- Draggable panel (v4.59): grab the header to move it anywhere; the position sticks
        // across opens (KEY_PANEL_POS). Clamped to the viewport so it can't be lost off-screen;
        // double-click the header to snap back to the default bottom-right dock.
        const headerEl = panel.querySelector('header');
        headerEl.title = 'Drag to move · double-click to reset position';
        const applyPos = (left, top) => {
            const w = panel.offsetWidth || 460;
            const L = Math.min(Math.max(0, left), Math.max(0, window.innerWidth - w));
            const T = Math.min(Math.max(0, top), Math.max(0, window.innerHeight - 44)); // keep the header grabbable
            panel.style.left = L + 'px'; panel.style.top = T + 'px';
            panel.style.right = 'auto'; panel.style.bottom = 'auto';
        };
        const savedPos = GM_getValue(KEY_PANEL_POS, null);
        if (savedPos && typeof savedPos.left === 'number' && typeof savedPos.top === 'number') applyPos(savedPos.left, savedPos.top);
        headerEl.addEventListener('dblclick', () => {
            GM_setValue(KEY_PANEL_POS, null);
            panel.style.left = panel.style.top = panel.style.right = panel.style.bottom = ''; // back to the CSS default dock
        });
        headerEl.addEventListener('pointerdown', (e) => {
            if (e.button !== 0 || e.target.closest('button')) return; // left-drag only; never hijack the × button
            const r = panel.getBoundingClientRect();
            const dx = e.clientX - r.left, dy = e.clientY - r.top;
            const move = (ev) => applyPos(ev.clientX - dx, ev.clientY - dy);
            const up = () => {
                document.removeEventListener('pointermove', move);
                document.removeEventListener('pointerup', up);
                const rr = panel.getBoundingClientRect();
                GM_setValue(KEY_PANEL_POS, { left: Math.round(rr.left), top: Math.round(rr.top) });
            };
            document.addEventListener('pointermove', move);
            document.addEventListener('pointerup', up);
            e.preventDefault();
        });

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

    // ===== Day-by-category summary ("timesheet roll-up") ===============================
    // Map each plant visit's estimated minutes onto Thomas's Rocketlane time categories. pang only sees
    // hands-on plant work, so ONLY plant-work categories are inferred — meetings, admin, planning,
    // documentation and training never touch pang and are deliberately left out (add those yourself).
    //
    // Designer and AK3-scanner setup log very FEW pang clicks but take real time, so the click-based
    // estimate under-counts them. The split fixes that: it carves a NOMINAL chunk for each Designer
    // (CAT_DESIGNER_MIN_EACH) and AK3 (CAT_AK3_MIN_EACH) action off the visit's minutes, then routes the
    // remainder to Integration when there's real config evidence (a non-graphic commit, phpMyAdmin, or
    // system-tools), to Drawing if the visit was graphic-only, to Setup if AK3-only, else to a quick
    // Support check. Validated against a known multi-site commissioning day (reproduces a by-hand split
    // within a few %). Category labels match Thomas's Rocketlane task list verbatim for 1:1 entry.
    const CAT_INTEGRATION = 'Project - Integration';
    const CAT_DRAWING     = 'Project - Drawing & Design';
    const CAT_SETUP_PC    = 'Setup - PC / Gateway';
    const CAT_SUPPORT     = 'Support - External';
    const CAT_CHECK       = 'Quick check'; // short access-only visit ("just popped in") — shown for awareness, NOT booked
    const CAT_ORDER = [CAT_INTEGRATION, CAT_DRAWING, CAT_SETUP_PC, CAT_SUPPORT, CAT_CHECK];
    const CAT_NOT_BOOKED = new Set([CAT_CHECK]); // shown in the roll-up but excluded from the Copy-to-timesheet total
    const CAT_COLOR = { [CAT_INTEGRATION]: '#0f62fe', [CAT_DRAWING]: '#8a3ffc', [CAT_SETUP_PC]: '#007d79', [CAT_SUPPORT]: '#ff832b', [CAT_CHECK]: '#8d8d8d' };
    const CAT_SHORT = { [CAT_INTEGRATION]: 'Integration', [CAT_DRAWING]: 'Drawing', [CAT_SETUP_PC]: 'Setup', [CAT_SUPPORT]: 'Support', [CAT_CHECK]: 'Quick check' };
    const CAT_AK3_MIN_EACH      = 18; // minutes credited to Setup per ak3_setup action (click-light, time-heavy)
    const CAT_DESIGNER_MIN_EACH = 8;  // minutes credited to Drawing per Designer action
    const CAT_CHECK_MAX_CLICKS  = 2;  // ≤ this many clicks (no commit) ⇒ a quick check even if a long gap over-credited the time
    const QUICK_CHECK_MAX_MIN   = 15; // access-only visit under this (no config commit) ⇒ "just popped in to check", not real work
    const CAT_DESIGNER_ACTIONS  = new Set(['designer4', 'designer3', 'designer']);
    const CAT_AK3_ACTIONS       = new Set(['ak3_setup']);

    // Split ONE visit's estimated (or distributed) minutes across categories → { category: minutes }.
    function categorizeVisit(v) {
        const M = (v.normalized_minutes != null ? v.normalized_minutes : v.estimated_minutes) || 0;
        if (M <= 0) return {};
        const counts = v.action_counts || (v.actions || []).reduce((o, a) => (o[a] = (o[a] || 0) + 1, o), {});
        let designerN = 0, ak3N = 0;
        for (const a in counts) { if (CAT_DESIGNER_ACTIONS.has(a)) designerN += counts[a]; if (CAT_AK3_ACTIONS.has(a)) ak3N += counts[a]; }
        const pmaN = counts.pma_local || 0, sysN = counts.sys_tools || 0;
        const clicks = v.count || Object.values(counts).reduce((s, n) => s + n, 0);
        // Commit evidence: prefer the classified counts (Integration vs graphic-only); if unclassified, fall
        // back to "any triggered commit ⇒ Integration evidence".
        const cc = v.commit_classes;
        const integCommits  = cc ? cc.integration : (v.changes_in_window || 0);
        const designCommits = cc ? cc.design : 0;
        const hasInteg   = integCommits > 0 || pmaN > 0 || sysN > 0;
        const hasDrawing = designerN > 0 || designCommits > 0;
        const hasSetup   = ak3N > 0;
        if (!hasInteg && !hasDrawing && !hasSetup) {
            // Access-only session (Direct/VNC, no config touched): under ~15 min you most likely just popped in to
            // check something → a "Quick check" (shown but not booked); a sustained session ⇒ Integration.
            // Quick-ness keys off the RAW click estimate, not M — so a bookable visit can't flip to "quick"
            // just because normalize scaled its share below 15 min (keeps the bookable set stable). (v4.53, R2)
            const quick = ((v.estimated_minutes || 0) < QUICK_CHECK_MAX_MIN || clicks <= CAT_CHECK_MAX_CLICKS) && !(v.changes_in_window > 0);
            return { [quick ? CAT_CHECK : CAT_INTEGRATION]: M };
        }
        const res = {};
        let rem = M;
        if (hasSetup) { const s = (!hasInteg && !hasDrawing) ? rem : Math.min(rem, CAT_AK3_MIN_EACH * ak3N); res[CAT_SETUP_PC] = s; rem -= s; }
        if (hasDrawing) { const drawNom = Math.max(CAT_DESIGNER_MIN_EACH * Math.max(1, designerN), v.designer_minutes || 0); const d = hasInteg ? Math.min(rem, drawNom) : rem; res[CAT_DRAWING] = (res[CAT_DRAWING] || 0) + d; rem -= d; }
        if (rem > 0) {
            const bucket = hasInteg ? CAT_INTEGRATION : hasDrawing ? CAT_DRAWING : CAT_SETUP_PC;
            res[bucket] = (res[bucket] || 0) + rem;
        }
        return res;
    }

    // Roll every visit up into category totals → { rows:[{category, minutes, plants[]}], grand }.
    function dayCategoryTotals(visits) {
        const totals = {}, plantsBy = {};
        for (const v of visits) {
            const split = categorizeVisit(v);
            for (const cat in split) {
                totals[cat] = (totals[cat] || 0) + split[cat];
                (plantsBy[cat] = plantsBy[cat] || new Set()).add(v.name || v.plant_id);
            }
        }
        const rows = [];
        for (const c of CAT_ORDER) if (totals[c]) rows.push({ category: c, minutes: Math.round(totals[c]), plants: [...plantsBy[c]] });
        for (const c in totals) if (!CAT_ORDER.includes(c)) rows.push({ category: c, minutes: Math.round(totals[c]), plants: [...plantsBy[c]] });
        return { rows, grand: rows.reduce((s, r) => s + r.minutes, 0) };
    }

    const catHours = m => (m / 60).toFixed(1).replace(/\.0$/, '');

    // Per-plant category breakdown chips (the same split that feeds the day roll-up, shown on each row so
    // you can see which plant produced each category's time). Refines once commit classes arrive.
    function categoryChips(v) {
        const split = categorizeVisit(v);
        const cats = CAT_ORDER.filter(c => split[c]);
        for (const c in split) if (!CAT_ORDER.includes(c)) cats.push(c);
        if (!cats.length) return '';
        return cats.map(c => {
            const color = CAT_COLOR[c] || '#8d8d8d';
            return `<span class="catchip" title="${escapeHtml(c)}"><span class="catchip-dot" style="background:${color}"></span>${escapeHtml(CAT_SHORT[c] || c)} <b>${fmtMinutes(Math.round(split[c]))}</b></span>`;
        }).join('');
    }

    // Render the category roll-up into its container (called from applyAndRender; refines once commit
    // classes arrive). Includes a Copy button that yields paste-ready "Category: H h" lines for Rocketlane.
    function renderCategorySummary(container, visits, isoDate) {
        container.innerHTML = '';
        if (!visits || !visits.length) return;
        const { rows, grand } = dayCategoryTotals(visits);
        if (!rows.length || !grand) return;
        const head = document.createElement('div');
        head.className = 'catsum-head';
        head.innerHTML =
            `<span class="catsum-title">📋 Day by category <span class="catsum-q" title="Estimated timesheet split of your plant work. Designer &amp; AK3 setup are credited fixed time (they log few clicks); the rest goes to Integration when real config changed, else a short access-only visit (under ~15 min) is a Quick check — shown here but NOT added to the timesheet total. Plant work only — meetings, admin, documentation and training aren't in pang, so add those yourself.">ⓘ</span></span>` +
            `<span class="catsum-btns">` +
            `<button type="button" class="catsum-book" title="Create these entries in your Rocketlane timesheet: one per plant &amp; category, project matched by plant id, activity text from what actually changed. Quick checks are never booked; already-booked project+category lines are skipped. You confirm the plan first.">⤴ Book day</button>` +
            `<button type="button" class="catsum-copy" title="Copy this breakdown to paste into your timesheet">⧉ Copy</button></span>`;
        container.appendChild(head);
        for (const r of rows) {
            const pct = grand ? Math.round((r.minutes / grand) * 100) : 0;
            const color = CAT_COLOR[r.category] || '#8d8d8d';
            const row = document.createElement('div');
            row.className = 'catsum-row';
            row.title = `${r.plants.length} plant${r.plants.length === 1 ? '' : 's'}: ${r.plants.join(', ')}`;
            row.innerHTML =
                `<span class="catsum-name"><span class="catsum-dot" style="background:${color}"></span>${escapeHtml(r.category)}</span>` +
                `<span class="catsum-bar"><span style="width:${pct}%;background:${color}"></span></span>` +
                `<span class="catsum-h">${catHours(r.minutes)} h</span>`;
            container.appendChild(row);
        }
        const foot = document.createElement('div');
        foot.className = 'catsum-foot';
        const bookableMin = rows.filter(r => !CAT_NOT_BOOKED.has(r.category)).reduce((s, r) => s + r.minutes, 0);
        const checkMin    = rows.filter(r =>  CAT_NOT_BOOKED.has(r.category)).reduce((s, r) => s + r.minutes, 0);
        foot.textContent = `≈ ${catHours(bookableMin)} h to book` + (checkMin ? ` · ${catHours(checkMin)} h quick checks (not booked)` : '') + ` · estimate, adjust as needed`;
        container.appendChild(foot);
        head.querySelector('.catsum-copy').addEventListener('click', (e) => {
            const btn = e.currentTarget;
            const bookRows = rows.filter(r => !CAT_NOT_BOOKED.has(r.category)); // quick checks aren't booked
            const text = bookRows.map(r => `${r.category}: ${catHours(r.minutes)} h`).join('\n') + `\nTotal: ${catHours(bookableMin)} h (plant work)`;
            Promise.resolve(navigator.clipboard && navigator.clipboard.writeText(text))
                .then(() => { btn.textContent = '✓ Copied'; setTimeout(() => { btn.textContent = '⧉ Copy'; }, 1500); })
                .catch(() => { btn.textContent = 'Copy failed'; });
        });
        head.querySelector('.catsum-book').addEventListener('click', () => {
            if (!rlCreds()) { alert('No Rocketlane api-key found — reload this Rocketlane tab while logged in, then try again.'); return; }
            openBookingFlow(container, visits, isoDate);
        });
    }

    // ----- Full-scan result cache (keyed by username + date; hoisted from the panel in v4.101) -----
    // A full scan is ~7,600 requests / ~1 min, so we cache its result per date. Past dates
    // never change; today's can go stale as you keep working, which is why the footer shows
    // the cache time and a Full scan always re-runs and overwrites it.
    const cacheVisit = (v) => ({
        plant_id: v.plant_id, name: v.name, first_ts: v.first_ts, last_ts: v.last_ts,
        actions: v.actions, action_counts: v.action_counts, count: v.count, estimated_minutes: v.estimated_minutes,
        base_minutes: (v.base_minutes != null ? v.base_minutes : v.estimated_minutes), // click-only floor (never the commit-topped value)
        designer_minutes: v.designer_minutes || 0, // v4.56: was dropped by the cache — cached dates silently lost gap-based Drawing (v4.54)
        designer_last: v.designer_last || null,    // v4.60: last designer session {s,e} for the commit-anchored extension
        capped_gaps: v.capped_gaps || [],          // v4.56: long-silence metadata so the evidence-gated damping works on cached dates too
    });
    const readCache = (username, iso) => GM_getValue(KEY_SCAN_CACHE, {})?.[username]?.[iso] || null;
    // Write one or many dates to the cache. A full scan passes every date it found (browsing any
    // of them is then instant); Refresh passes just the one date it refreshed. Keyed by username + date.
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

    // Commit enrichment core — hoisted out of the panel closure (v4.93) so ⤴ Book week can enrich any
    // day's visits without the panel being open. Correlates each visit with its plant's config commits,
    // applies the time rules (isolated-touch cap, long-silence damping, designer extension, commit fusion)
    // and sets window_commits/day_commits for the booking texts. Idempotent — always recomputed from the
    // click baseline, so repeated calls never compound. Mutates the visit objects in place; returns
    // whether anything changed (the panel repaints on true).
    async function enrichVisitsWithCommits(visits, iso) {
        if (!visits || !visits.length) return false;
        const ids = [...new Set(visits.map(v => String(v.plant_id)))];
        // One call — gmFetchCommitsBatch pools single requests internally (3.2× faster cold than a
        // server-serialized batch) and serves repeat date-views from its session cache.
        const commits = await gmFetchCommitsBatch(ids);
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
            // ALL of the day's triggered commits (window or not) — booking texts read these too, since
            // the descriptive save often lands after the visit window (e.g. while on the next plant).
            v.day_commits = (commits[v.plant_id] || []).filter(c => pangDateToISODate(c.date) === iso && !isScheduledCommit(c));
            v.changes_in_window = triggered.length;
            v.change_times = triggered.map(c => tsToLocalTime(tsFromPangDate(c.date)));
            v.scheduled_in_window = inWin.length - triggered.length;   // counted, not shown as a change
            // Long-silence damping (v4.56): each capped 30-min gap credit is provisional — for a silence
            // longer than LONGGAP_MS, keep the full 30 only when a change-triggered commit for THIS plant
            // lands inside the silence's first LONGGAP_EVIDENCE_MS (proof you were still working on it);
            // otherwise re-credit it at LONGGAP_CREDIT_MIN (a long unevidenced silence is far more likely
            // a break/meeting than half an hour of work on that plant). Skipped when the commits fetch
            // failed (commits[..] undefined) or the visit came from a pre-4.56 cache (no capped_gaps).
            const commitList = commits[v.plant_id];
            const trigAll = Array.isArray(commitList)
                ? commitList.filter(c => !isScheduledCommit(c)).map(c => tsFromPangDate(c.date))
                : null;
            if (trigAll && Array.isArray(v.capped_gaps) && v.capped_gaps.length) {
                let cut = 0;
                for (const g of v.capped_gaps) {
                    if (!g || !(g.gap > LONGGAP_MS)) continue;
                    const evidenced = trigAll.some(t => t > g.ts && t <= g.ts + Math.min(g.gap, LONGGAP_EVIDENCE_MS));
                    if (!evidenced) cut += Math.round(ACTIVE_CAP_MS / 60000) - LONGGAP_CREDIT_MIN;
                }
                if (cut > 0) {
                    const b0 = (v.base_minutes != null ? v.base_minutes : v.estimated_minutes) || 0;
                    v.base_minutes = Math.max(1, b0 - cut);
                    v.longgap_cut_minutes = b0 - v.base_minutes; // for the verification dump
                }
            }
            // Commit-anchored designer extension (v4.60): a designer session's click-based end is
            // often a quick glance at ANOTHER plant — but the graphic save then commits on THIS
            // plant minutes later, proving the drawing continued (measured: 19 sessions / +190 min
            // over 3 months, e.g. designer 11:54 → glance elsewhere 11:57 → commit 12:08). Extend
            // the LAST designer session to the latest triggered commit within 20 min of its end,
            // still capped at 30 min per session. Category-only: moves minutes Drawing↔Integration
            // inside the visit; plant/day totals are untouched.
            if (trigAll && v.designer_last && typeof v.designer_last.e === 'number') {
                const capEnd = v.designer_last.s + ACTIVE_CAP_MS;
                if (v.designer_last.e < capEnd) {
                    const cands = trigAll.filter(t => t > v.designer_last.e && t <= v.designer_last.e + COMMIT_SESSION_MAX_MS);
                    if (cands.length) {
                        const add = Math.round((Math.min(Math.max(...cands), capEnd) - v.designer_last.e) / 60000);
                        if (add > 0) { v.designer_minutes = (v.designer_minutes || 0) + add; v.designer_ext_minutes = add; }
                    }
                }
            }
            // A single click that opened an ACCESS / VNC / diagnostics surface (phpMyAdmin, System tools,
            // Direct, Proxy, VNC, …) and committed NOTHING is a quick glance, not sustained work — yet the
            // 30-min gap cap can credit it up to 30 min. Cap its click-only floor to ISOLATED_TOUCH_CAP.
            // Edit surfaces (Designer/AK3) and server actions are deliberate work and are NOT capped. Uses
            // v.actions (set on both scan paths), so the cap now also applies on quick/single-date scans. (v4.53, R-g)
            if ((v.count || 0) === 1 && triggered.length === 0 && (v.actions || []).length === 1) {
                const cat0 = (ACTION_META[v.actions[0]] || {}).cat;
                if (cat0 === 'access' || cat0 === 'vnc' || cat0 === 'diag') {
                    const b0 = (v.base_minutes != null ? v.base_minutes : v.estimated_minutes) || 0;
                    if (b0 > ISOLATED_TOUCH_CAP) v.base_minutes = ISOLATED_TOUCH_CAP;
                }
            }
            // Time fusion — additive, bounded, idempotent (always recomputed from the click baseline, so
            // repeated re-renders never compound). For a sparse config session, credit the real active
            // span [first click → last triggered commit], clamped to [MIN, MAX], and lift estimated_minutes
            // to it when the click-only base is lower. Click-heavy plants never qualify, so addMs stays 0.
            const base = (v.base_minutes != null ? v.base_minutes : v.estimated_minutes) || 0;
            if (sparseConfig && triggered.length) {
                // The triggered commit is the only hard evidence of when this sparse sub-tool session ended.
                const lastC = tsFromPangDate(triggered[triggered.length - 1].date);
                const sessionMin = Math.round(Math.min(Math.max(lastC - v.first_ts, COMMIT_SESSION_MIN_MS), COMMIT_SESSION_MAX_MS) / 60000);
                const capMin = Math.round(ACTIVE_CAP_MS / 60000);
                // Lift a low click-base UP to the session span; and when the base only reached its value because
                // a long cross-plant idle hit the 30-min gap cap (base ≥ cap — unearnable from ≤2 clicks), pull
                // it DOWN to the commit-defined span. Sub-cap bases stay lift-only → no regression (v4.52, R1).
                v.estimated_minutes = (base >= capMin) ? sessionMin : Math.max(base, sessionMin);
            } else {
                v.estimated_minutes = base;
            }
            v.commit_added_minutes = v.estimated_minutes - base;      // may be negative when the cap artifact is corrected
            if (triggered.length || v.commit_added_minutes) any = true;
        }
        // NOTE: no per-commit content classification. A measurement over 30 real days (457 triggered
        // commits across 94 plants) found 100% classify as "integration" — adding a device commits the
        // graphic table AND the device tables together, so commit CONTENT can never isolate Drawing/Settings.
        // `changes_in_window > 0` is therefore the identical signal; categorizeVisit's fallback uses it.
        // (Removed the v4.48 tables.php pass — it fetched per-commit table lists that never changed routing.)
        return any;
    }

    // ===== ⤴ Book day — write the split straight into the Rocketlane timesheet (v4.62) ==========
    // One click books every bookable plant/category line for the shown date via Rocketlane's own API
    // (the same api-key the web app uses, read from localStorage.__api_key like the chat-bridge does).
    // Page-context fetch is CORS-blocked (the app tunnels through a comlink iframe), so all calls go
    // through GM_xmlhttpRequest. Payload verified by a live trial: POST /users/{id}/time-entries with
    // { date, minutes, activityName, billable, categoryId (FLAT — mandatory per timesheet config),
    // projectId } → 201. Quick checks are never booked. Dedupe: an entry for the same project+category
    // already on that date is skipped, so re-clicking can't double-book.
    const RL_API = 'https://kiona.api.rocketlane.com/api/v1';
    const KEY_RL_PROJECTS = 'rl_projects_cache';      // { fetched_at, list: [{id, name}] }
    const RL_PROJECTS_TTL_MS = 24 * 60 * 60 * 1000;   // project inventory refreshes daily (or on a cache miss)
    const BOOK_MAX_COMMITS = 4;                       // newest triggered commits inspected for activity texts
    // "RAC" in the matched project name or in a changed table ⇒ the work is gateway setup, not integration.
    const RAC_RE = /(^|[\s_.:\-(])rac([\s_.:\-)]|$|\d)/i;
    // Internal plant machinery whose tables change as a side-effect of the system running — never present
    // them as work ("tuned Data Engine") and never let them feed the task matcher.
    const BOOK_NOISE_RE = /data_engine|sysinfo/i;
    // Same idea for individual plant-setting ROWS: "scripts (PHP-APP)" stream lists etc. are sys config churn.
    const SETT_NOISE_RE = /\bscripts?\b|php.?app|data.?engine|sysinfo/i;

    function rlCreds() {
        try {
            const a = JSON.parse(localStorage.getItem('__api_key')); // page localStorage is shared with the sandbox
            if (Array.isArray(a) && a[1] && a[2]) return { apiKey: String(a[1]), userId: a[2] };
        } catch (e) { /* fall through */ }
        return null;
    }
    function rlFetch(method, path, body) {
        return new Promise((resolve) => {
            const creds = rlCreds();
            if (!creds) { resolve({ status: 0, json: null, error: 'no api-key (open Rocketlane while logged in)' }); return; }
            const url = RL_API + path;
            if (!url.startsWith(RL_API)) { resolve({ status: 0, json: null, error: 'origin pin' }); return; } // never send the key elsewhere
            GM_xmlhttpRequest({
                method, url,
                headers: Object.assign({ 'api-key': creds.apiKey, 'accept': 'application/json' },
                    body ? { 'content-type': 'application/json' } : {}),
                data: body ? JSON.stringify(body) : undefined,
                timeout: 30000,
                onload: r => { let j = null; try { j = JSON.parse(r.responseText); } catch (e) {} resolve({ status: r.status, json: j, raw: r.responseText }); },
                onerror: () => resolve({ status: 0, json: null, error: 'network' }),
                ontimeout: () => resolve({ status: 0, json: null, error: 'timeout' }),
            });
        });
    }
    // Full project inventory (~1200), paginated 100/page, cached a day. Names carry the plant id prefix
    // ("2184 - Meny Hundvåg: ombygging"), which is what plant→project matching keys on. ARCHIVED projects
    // are dropped: they reject time entries with 400 "Invalid projectId", and plants can have an archived
    // duplicate next to the live project (2619 had both — the archived one matched first and 400'd).
    async function rlProjects(force) {
        const cached = GM_getValue(KEY_RL_PROJECTS, null);
        if (!force && cached && cached.v === 2 && cached.list && (Date.now() - cached.fetched_at) < RL_PROJECTS_TTL_MS) return cached.list;
        const list = [];
        for (let page = 1; page <= 20; page++) {
            const r = await rlFetch('GET', `/projects?pageSize=100&page=${page}`);
            const arr = Array.isArray(r.json) ? r.json : null;
            if (!arr) break;
            for (const p of arr) if (p && p.projectId && p.projectName && !p.archived) list.push({ id: p.projectId, name: p.projectName });
            if (arr.length < 100) break;
        }
        if (list.length) GM_setValue(KEY_RL_PROJECTS, { v: 2, fetched_at: Date.now(), list });
        return list.length ? list : (cached && cached.list) || [];
    }
    function rlFindProject(list, plantId) {
        const re = new RegExp('^\\s*' + String(plantId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[-–—:.]');
        return list.find(p => re.test(p.name)) || null;
    }
    let _rlCategories = null; // name → categoryId (session cache)
    async function rlCategories() {
        if (_rlCategories) return _rlCategories;
        // One retry — a lone 429/hiccup on this call left a whole Book week day category-less (v4.99,
        // seen live: Monday's project rows all ⚠ no-category while Tue–Fri were fine).
        for (let attempt = 0; attempt < 2; attempt++) {
            const r = await rlFetch('GET', '/timesheets/categories');
            const map = {};
            if (Array.isArray(r.json)) for (const c of r.json) if (!c.deleted) map[c.categoryName] = c.categoryId;
            if (Object.keys(map).length) { _rlCategories = map; return map; }
            if (!attempt) await new Promise(res => setTimeout(res, 1200));
        }
        return {};
    }
    const _rlWeekCache = new Map(); // mondayIso -> { t, p } — collapses Book week's 5 identical weekly GETs (cleared after booking)
    async function rlEntriesOn(iso) {
        const creds = rlCreds(); if (!creds) return [];
        const d = new Date(iso + 'T12:00:00');
        const monday = new Date(d); monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
        const mIso = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
        const hit = _rlWeekCache.get(mIso);
        let p = (hit && Date.now() - hit.t < 60000) ? hit.p : null;
        if (!p) { p = rlFetch('GET', `/users/${creds.userId}/timesheets/${mIso}?useNewLogic=true&sourcePage=MY_TIME_SHEET`); _rlWeekCache.set(mIso, { t: Date.now(), p }); }
        const r = await p;
        // The weekly response's wrapping VARIES (bare object / [{…}] / multi-element arrays, depending on
        // auth context and backend node). Stop chasing shapes: walk the whole payload (bounded) and collect
        // anything that looks like a time entry — an object carrying `date` + `timeEntryId`.
        const entries = [];
        let sawEntries = false; // saw the timesheet STRUCTURE (an `entries` ARRAY anywhere, even empty)
        const walk = (node, depth) => {
            if (!node || depth > 5) return;
            if (Array.isArray(node)) { for (const x of node) walk(x, depth + 1); return; }
            if (typeof node !== 'object') return;
            if (node.date && node.timeEntryId) { entries.push(node); return; }
            if (Array.isArray(node.entries)) sawEntries = true;
            for (const val of Object.values(node)) if (val && typeof val === 'object') walk(val, depth + 1);
        };
        walk(r.json, 0);
        const onDate = entries.filter(e => e && e.date === iso);
        LOG('book: weekly', mIso, 'status', r.status, 'entries', entries.length, 'structSeen', sawEntries, '→ on', iso, onDate.length,
            r.status !== 200 ? ('body: ' + String(r.raw).slice(0, 180)) : '');
        // A cleared/fresh week legitimately returns `entries: []` (verified against the UI 2026-07-06 —
        // Thomas empties a week, then Book week refills it). Recognized-but-empty structure is therefore
        // trusted (v4.98); only a non-200 or a response with NO recognizable structure blocks booking.
        onDate._checkOk = r.status === 200 && (entries.length > 0 || sawEntries);
        return onDate;
    }

    // What to WRITE per category — read the visit's newest triggered commits: added devices for the
    // Integration text, the changed graphic panel NAMES for the Drawing text ("Drawing: Wireless
    // Overview"), and a RAC sniff on every changed table name.
    function bookPrettyToken(t) {
        let s = String(t).replace(/^iw_(set|par)_/, '').replace(/_(groups|param)$/, '').replace(/^da3_/, '');
        return s.split('_').map(w => /\d/.test(w) ? w.toUpperCase() : (w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
    }
    async function bookTexts(v) {
        const out = { integration: '', drawing: '', racHit: false, drawingNames: [], drawingLines: [], hints: '' };
        // Always-available fallbacks (no commits needed): what TOOLS the session used, and when the
        // Designer session ran — far more informative than a generic "device/DB config".
        const ACT_WORDS = { pma_local: 'phpMyAdmin', sys_tools: 'topology', start_vnc: 'VNC', restart_plant_server: 'restarts', upload: 'backup', ak3_setup: 'AK3', client_admin: 'client admin', file_upload: 'file upload', direct_plant: 'direct login', designer4: 'Designer', designer3: 'Designer', get_status: 'status check' };
        const ac = v.action_counts || {};
        const actEntries = Object.entries(ac).filter(([a]) => ACT_WORDS[a]).sort((x, y) => y[1] - x[1]);
        out.actionsWork = actEntries.filter(([a]) => !/^(direct_plant|designer|get_status)/.test(a)).slice(0, 3).map(([a]) => ACT_WORDS[a]).join(' + ');
        // Notes fallback when no config commit exists: the session described by its TOOLS + counts —
        // "Worked via phpMyAdmin ×3 · VNC · topology ×2" beats an empty Notes field.
        out.notesActions = actEntries.length
            ? 'Worked via ' + actEntries.slice(0, 5).map(([a, n]) => ACT_WORDS[a] + (n > 1 ? ` ×${n}` : '')).join(' · ')
            : '';
        if (v.designer_last && v.designer_last.s) out.designerSession = 'Designer session'; // no timestamps — the entry carries its own date/duration
        // Texts read the visit-window commits PLUS the rest of the day's triggered commits — the save
        // that describes your work often lands after the visit window (e.g. during the next plant).
        const seen = new Set(); const commits = [];
        for (const c of [...(v.window_commits || []), ...(v.day_commits || [])]) { const id = String(c.id); if (!seen.has(id)) { seen.add(id); commits.push(c); } }
        commits.sort((a, b) => tsFromPangDate(a.date) - tsFromPangDate(b.date));
        const newest = commits.slice(-BOOK_MAX_COMMITS);
        if (!newest.length) { out.notesDraw = out.designerSession || ''; return out; }
        const cids = newest.map(c => String(c.id));
        let patches = {};
        try { patches = await gmFetchTablesPatchBatch(cids); } catch (e) { return out; }
        const devAdd = [], devMod = new Set(), graphicCids = [], unitJobs = [], settJobs = [], tuneJobs = [];
        const tuneSeen = new Set();
        let virtVals = false;
        for (const cid of cids) {
            const tables = Object.entries(patches[cid] || {}).filter(([t, m]) => m && m.mode);
            for (const [t, m] of tables) {
                if (RAC_RE.test(t)) out.racHit = true;
                // Internal machinery, not user work: the Data Engine / sysinfo tables drift as a side-effect
                // of running the plant — "tuned Data Engine" in a timesheet is meaningless noise.
                if (BOOK_NOISE_RE.test(t)) continue;
                if (/^iw_set_/.test(t)) { if (m.mode === 'add') devAdd.push(bookPrettyToken(t)); else if (/^mod/.test(m.mode)) devMod.add(bookPrettyToken(t)); }
                // Parameter tuning lives in iw_par_<device>_param/_groups — count a MOD there as "tuned <device>"
                if (/^iw_par_.+_(param|groups)$/.test(t) && /^mod/.test(m.mode)) devMod.add(bookPrettyToken(t));
                // Diff a few tuned tables so the notes can say WHICH params changed (newest commit wins per table).
                if ((/^iw_set_/.test(t) || /^iw_par_.+_param$/.test(t)) && /^mod/.test(m.mode) && !tuneSeen.has(t) && tuneJobs.length < 4) { tuneSeen.add(t); tuneJobs.push({ table_name: t, commit: cid }); }
                if (t === 'iw_sys_virtual_values' && /^mod/.test(m.mode)) virtVals = true;
                if (/graphic_designer/i.test(t)) graphicCids.push(cid);
                if (t === 'iw_sys_plant_units') unitJobs.push({ table_name: t, commit: cid });
                if (t === 'iw_sys_plant_settings' && /^mod/.test(m.mode)) settJobs.push({ table_name: t, commit: cid });
            }
        }
        // When nothing was "added", say what really happened: diff the units table (added / removed /
        // RENAMED units, with a couple of the new names) and plant settings (which settings changed).
        let uAdd = 0, uDel = 0, uRen = 0;
        const uAddNames = [], uRenNames = [], renPairs = [];  // unit LABELS + "old → new" rename pairs, drawer-style
        const settNames = [], settDetails = [];               // names for the title; "name: old → new" for the notes
        const tuneMap = new Map();                            // device pretty-name -> [changed param labels]
        const bookClipVal = s => { s = String(s == null ? '' : s); return s.length > 18 ? s.slice(0, 16) + '…' : s; };
        const SECRET_RE = /pass|pwd|secret|token|key/i;       // never print secret VALUES in a timesheet note
        const jobs = unitJobs.concat(settJobs, tuneJobs);
        if (jobs.length) {
            try {
                const vers = await gmFetchTwoVersionsBatch(jobs);
                for (let i = 0; i < jobs.length; i++) {
                    const ver = vers[i]; if (!ver) continue;
                    const d = chgDiff(ver);
                    if (d.unreadable) continue;
                    const tbl = jobs[i].table_name;
                    if (tbl === 'iw_sys_plant_units') {
                        uAdd += d.added.length; uDel += d.removed.length;
                        for (const a of d.added) { const l = chgUnitLabel(a); if (l && !uAddNames.includes(l)) uAddNames.push(l); }
                        const renRows = new Set();
                        for (const m of d.modified) if (m.col === 'unit_name') {
                            renRows.add(m.key);
                            if (m.to && !uRenNames.includes(m.to)) uRenNames.push(m.to);
                            const pair = (m.from ? m.from + ' → ' : '') + (m.to || '');
                            if (pair && !renPairs.includes(pair)) renPairs.push(pair);
                        }
                        uRen += renRows.size;
                    } else if (tbl === 'iw_sys_plant_settings') {
                        for (const m of d.modified) {
                            const full = String(chgRowLabel(m) || '');
                            // System-internal settings churn on their own ("scripts (PHP-APP)" stream lists,
                            // data-engine/sysinfo housekeeping) — never present them as work.
                            if (SETT_NOISE_RE.test(full)) continue;
                            const lbl = full.replace(/\s*\(.*\)$/, '');
                            if (lbl && !settNames.includes(lbl)) settNames.push(lbl);
                            const f = bookClipVal(m.from), t = bookClipVal(m.to);
                            // Secret values, or values identical after clipping ("1;stream_… → 1;stream_…"): say "changed".
                            const detail = (SECRET_RE.test(full) || f === t) ? `${full}: changed` : `${full}: ${f} → ${t}`;
                            if (full && !settDetails.some(x => x.startsWith(full + ':'))) settDetails.push(detail);
                        }
                    } else {
                        // a tuned device table: collect WHICH params changed (drawer-style row labels)
                        const dev = bookPrettyToken(tbl);
                        const rowsSeen = tuneMap.get(dev) || [];
                        for (const m of d.modified) {
                            const lbl = String(chgRowLabel(m) || m.col || '').trim();
                            if (lbl && rowsSeen.length < 6 && !rowsSeen.includes(lbl)) rowsSeen.push(lbl);
                        }
                        if (rowsSeen.length) tuneMap.set(dev, rowsSeen);
                    }
                }
            } catch (e) { /* keep what we have */ }
        }
        // Compose the Integration text. Added units are named by their UNIT LABELS (like the 🔧 drawer's
        // "Device added: AK-CC55-017x 6 (000:006)") — the raw driver-table tokens ("080Z0202 041X") only
        // appear when the units diff wasn't available.
        const bits = [];
        if (uAdd) {
            bits.push('added ' + uAddNames.slice(0, 2).join(', ') + (uAdd > 2 ? ` +${uAdd - 2} more` : ''));
        } else if (devAdd.length) {
            const u = [...new Set(devAdd)];
            bits.push('added ' + u.slice(0, 3).join(', ') + (u.length > 3 ? ` +${u.length - 3} more` : ''));
        }
        if (uDel) bits.push(`-${uDel} unit${uDel === 1 ? '' : 's'}`);
        if (uRen) bits.push(`named ${uRen} unit${uRen === 1 ? '' : 's'}` + (uRenNames.length ? ` (${uRenNames.slice(0, 2).join(', ')}…)` : ''));
        if (devMod.size) { const u = [...devMod].filter(x => devAdd.indexOf(x) < 0); if (u.length) bits.push('tuned ' + u.slice(0, 3).join(', ') + (u.length > 3 ? ` +${u.length - 3}` : '')); }
        if (virtVals) bits.push('virtual values');
        if (settNames.length) bits.push('plant settings: ' + settNames.slice(0, 2).join(', ') + (settNames.length > 2 ? ` +${settNames.length - 2}` : ''));
        let integ = bits.join(' · ');
        if (integ.length > 110) integ = integ.slice(0, 108) + '…';
        out.integration = integ;
        if (graphicCids.length) {
            const jobs = [...new Set(graphicCids)].map(c => ({ table_name: 'iw_sys_graphic_designer', commit: c }));
            try {
                const vers = await gmFetchTwoVersionsBatch(jobs);
                // Per-panel detail across the day's commits, drawer-style: first rev → last rev + what
                // was edited (layout / background image). Feeds both the names and the Notes lines.
                const panels = new Map(); // panel -> { from, to, what:Set, added }
                for (const ver of vers) {
                    if (!ver) continue;
                    const d = chgDiff(ver);
                    const byPanel = new Map();
                    for (const m of d.modified) { if (!byPanel.has(m.key)) byPanel.set(m.key, []); byPanel.get(m.key).push(m); }
                    for (const [key, mods] of byPanel) {
                        const panel = String(key).split(CHG_SEP).filter(Boolean).join(' / ') || '(panel)';
                        const p = panels.get(panel) || { from: null, to: null, what: new Set(), added: false };
                        const rev = mods.find(m => m.col === 'revision');
                        if (rev) { if (p.from == null) p.from = rev.from; p.to = rev.to; }
                        if (mods.some(m => m.col === 'xml' || m.col === 'json')) p.what.add('layout');
                        if (mods.some(m => /picture|image|thumb|icon/i.test(m.col || ''))) p.what.add('background image');
                        panels.set(panel, p);
                    }
                    for (const a of d.added) { const l = chgRowLabel(a); if (l && !panels.has(l)) panels.set(l, { from: null, to: null, what: new Set(), added: true }); }
                }
                if (panels.size) {
                    out.drawingNames = [...panels.keys()];
                    out.drawing = out.drawingNames.slice(0, 3).join(', ');
                    out.drawingLines = [...panels.entries()].map(([panel, p]) => {
                        let txt = panel;
                        if (p.added) txt += ' (new)';
                        if (p.from != null) txt += `: rev ${p.from} → ${p.to}`;
                        if (p.what.size) txt += ' · ' + [...p.what].join(' + ') + ' edited';
                        return txt;
                    });
                }
            } catch (e) { /* fallback text */ }
        }
        // DETAILED multi-line notes for the time entry's Notes field — informative but CAPPED, so a big
        // commissioning day doesn't dump 20 lines into one note (the activity title stays short regardless).
        const nInteg = [];
        if (uAddNames.length) nInteg.push('Added: ' + uAddNames.slice(0, 5).join(', ') + (uAdd > 5 ? ` (+${uAdd - 5} more)` : ''));
        else if (devAdd.length) { const u = [...new Set(devAdd)]; nInteg.push('Added: ' + u.slice(0, 5).join(', ') + (u.length > 5 ? ` (+${u.length - 5} more)` : '')); }
        if (renPairs.length) nInteg.push('Renamed: ' + renPairs.slice(0, 5).join(', ') + (uRen > 5 ? ` (+${uRen - 5} more)` : ''));
        if (uDel) nInteg.push(`Removed: ${uDel} unit${uDel === 1 ? '' : 's'}`);
        if (devMod.size) {
            const u = [...devMod].filter(x => devAdd.indexOf(x) < 0);
            if (u.length) {
                // Show WHICH params changed for up to 2 tuned devices ("Data Engine (poll_rate, log_level +3)");
                // remaining devices by name only.
                const parts = [];
                for (const dev of u.slice(0, 4)) {
                    const rows = tuneMap.get(dev);
                    if (rows && rows.length && parts.filter(p => p.includes('(')).length < 2) {
                        parts.push(dev + ' (' + rows.slice(0, 3).join(', ') + (rows.length > 3 ? ` +${rows.length - 3}` : '') + ')');
                    } else parts.push(dev);
                }
                nInteg.push('Tuned params: ' + parts.join(', ') + (u.length > 4 ? ` (+${u.length - 4} more)` : ''));
            }
        }
        if (virtVals) nInteg.push('Virtual values changed');
        if (settDetails.length) nInteg.push('Plant settings: ' + settDetails.slice(0, 3).join('; ') + (settDetails.length > 3 ? ` (+${settDetails.length - 3} more)` : ''));
        else if (settNames.length) nInteg.push('Plant settings: ' + settNames.slice(0, 4).join(', ') + (settNames.length > 4 ? ` (+${settNames.length - 4} more)` : ''));
        out.notesInteg = nInteg.join('\n');
        const nDraw = [];
        if (out.drawingLines && out.drawingLines.length) {
            const lines = out.drawingLines.slice(0, 4);
            nDraw.push(lines.length === 1 ? 'Drawing changed: ' + lines[0] : 'Drawings changed:');
            if (lines.length > 1) for (const l of lines) nDraw.push('- ' + l);
            if (out.drawingLines.length > 4) nDraw.push(`(+${out.drawingLines.length - 4} more drawings)`);
        } else if (out.drawingNames.length) {
            nDraw.push('Drawings changed: ' + out.drawingNames.slice(0, 4).join(', '));
        } else if (out.designerSession) {
            nDraw.push(out.designerSession); // fallback only — real drawing detail replaces it
        }
        out.notesDraw = nDraw.join('\n');
        // Curated evidence for the task matcher, TIERED (v4.82): tokStr = device-table tokens (framework
        // tables iw_sys_*/iw_gen_*/iw_lnk_* excluded — their names word-match nonsense) — system-level
        // truth; uStr = unit add/rename NAMES — fallback tier only, since MQTT sensors get renamed to
        // "Kjøttdisk"/"Fryserom" and would otherwise pull every day into refrigeration.
        const tokset = new Set();
        for (const cid of cids) for (const [t, m] of Object.entries(patches[cid] || {})) {
            if (m && m.mode && !/^iw_(sys|gen|lnk)_/.test(t) && !BOOK_NOISE_RE.test(t)) tokset.add(bookPrettyToken(t).toLowerCase());
        }
        out.tokStr = [...tokset].concat(devAdd, [...devMod]).join(' ').toLowerCase();
        out.uStr = uAddNames.concat(uRenNames).join(' ').toLowerCase();
        out.hints = [out.tokStr, out.uStr, settNames.join(' '), out.drawingNames.join(' ')].join(' ').toLowerCase(); // for the LOG
        return out;
    }

    // ---- Task-first booking: prefer an EXISTING project task over creating an activity -----------
    // Projects carry structured work packages ("Integration: Refrigeration", "Design: Wireless overview",
    // bare-discipline tasks like "Wireless"). Book onto the best-fitting one (the rich what-changed text
    // goes into the entry's NOTES); only when nothing fits does the button create an activity like before.
    const _rlTasksCache = {}; // projectId -> [{taskId, taskName}] (session cache)
    async function rlTasks(projectId) {
        if (_rlTasksCache[projectId]) return _rlTasksCache[projectId];
        const r = await rlFetch('GET', `/tasks/search?project.value=${projectId}&match=all`);
        let arr = r.json;
        if (arr && !Array.isArray(arr)) arr = arr.tasks || arr.data || [];
        const tasks = (Array.isArray(arr) ? arr : []).filter(t => t && t.taskId && t.taskName)
            .map(t => ({
                taskId: t.taskId, taskName: String(t.taskName), done: !!t.completedAt, // done ⇒ ticked off in the plan
                phase: String((t.projectPhase && t.projectPhase.projectPhaseName) || ''), // category/phase carries the discipline for bare-named tasks
                parentTask: t.parentTask || (t.parentTaskObject && t.parentTaskObject.taskId) || null, // v1 tenant shape: FLAT id (+ a redundant object) — see ensureBucketSubtask
            }));
        _rlTasksCache[projectId] = tasks;
        return tasks;
    }
    // ---- Team-bucket subtasks: "Oppgaver utenfor Rocketlane" (v4.105) -----------------------------
    // Team bucket projects (Team Kulde Oppgaver, …) keep a container task with one SUBTASK per
    // no-project plant ("6163 - COOP PRIX Undheim"). When booking a no-project plant into a bucket
    // that has that container, the time entry belongs on the plant's subtask — found by its
    // "<plant id> -" name prefix, or created under the container.
    // Buckets WITHOUT the container keep the old bare-activity behaviour.
    //
    // ⚠ TWO APIs, TWO PARENT FIELD NAMES (the v4.108 fix). The public docs at
    // developer.rocketlane.com describe `https://api.rocketlane.com/api/1.0` where a task's parent is
    // NESTED: `parent: { taskId }`. This script talks to the TENANT api
    // (`kiona.api.rocketlane.com/api/v1`), whose task objects carry a FLAT `parentTask` integer (plus a
    // redundant `parentTaskObject`) — verified on all 32 hand-made subtasks of the Team Kulde container.
    // Unknown body fields are silently DROPPED, never rejected (measured across 5 shapes, all HTTP 200,
    // all no-ops). So ≤4.107 posted only the public shape, got a 201 back, logged "created … under
    // <container>" — and created a task with `parentTask: null`, floating at the top level of the
    // project. Everything else worked (booking, Description log), which is why it went unnoticed.
    // Fix: send EVERY spelling in one body, then READ THE TASK BACK and log whether it stuck. The
    // read-back is the point — `PUT /tasks/{id}` has no parent field at all (13 documented body params,
    // none of them a parent), so a detached task can only be repaired by dragging it in the Rocketlane
    // UI. Saying so in the console beats another silent success.
    const BUCKET_PARENT_RE = /oppgaver\s+utenfor\s+rocketlane/i;
    const _bucketSubtaskMemo = new Map(); // `${projectId}|${plant_id}` -> taskId | null (per session)
    async function ensureBucketSubtask(projectId, plantId, plantName) {
        const memoKey = projectId + '|' + plantId;
        if (_bucketSubtaskMemo.has(memoKey)) return _bucketSubtaskMemo.get(memoKey);
        let out = null;
        try {
            const tasks = await rlTasks(projectId);
            const parent = tasks.find(t => BUCKET_PARENT_RE.test(t.taskName));
            if (parent) {
                const pid = parent.taskId;
                const pidRe = new RegExp('^\\s*' + String(plantId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[-–—:.]');
                const cand = tasks.filter(t => t.taskId !== pid && pidRe.test(t.taskName));
                // Prefer a real child of the container over a same-named stray left top-level by ≤4.107.
                const hit = cand.find(t => String(t.parentTask || '') === String(pid)) || cand[0];
                if (hit) out = hit.taskId;
                else {
                    const name = `${plantId} - ${plantName || plantId}`;
                    let r = await rlFetch('POST', '/tasks', { taskName: name, project: { projectId }, parent: { taskId: pid }, parentTask: pid, parentTaskId: pid });
                    if (!(r.status === 200 || r.status === 201))
                        r = await rlFetch('POST', '/tasks', { taskName: name, projectId, parentTask: pid, parentTaskId: pid });
                    const t = r.json && (r.json.taskId ? r.json : (r.json.data && r.json.data.taskId ? r.json.data : null));
                    if ((r.status === 200 || r.status === 201) && t && t.taskId) {
                        out = t.taskId;
                        const rec = { taskId: t.taskId, taskName: name, done: false, phase: '', parentTask: null };
                        (_rlTasksCache[projectId] = _rlTasksCache[projectId] || []).push(rec);
                        LOG('book: created bucket subtask', name, '→', t.taskId, 'under', parent.taskName);
                        rec.parentTask = await verifyBucketSubtaskParent(t.taskId, pid, name, parent.taskName);
                    } else {
                        LOG('book: bucket subtask create failed', r.status, String(r.raw || r.error || '').slice(0, 160));
                    }
                }
            }
        } catch (err) { LOG('book: bucket subtask lookup failed', String(err)); }
        _bucketSubtaskMemo.set(memoKey, out); // a failed create memoises null → this run falls back to the activity style
        return out;
    }
    // Read a freshly created subtask back and report whether the parent actually attached (v4.108).
    // A 201 proves only that the row exists; see the field-name note above. Never throws and never
    // affects the booking — the task is usable either way, it just sits in the wrong place.
    async function verifyBucketSubtaskParent(taskId, parentId, name, parentName) {
        try {
            const g = await rlFetch('GET', `/tasks/${taskId}`);
            const t = g.json && (g.json.taskId ? g.json
                : g.json.data && g.json.data.taskId ? g.json.data
                : g.json.task && g.json.task.taskId ? g.json.task : null);
            if (!t) { LOG('book: subtask parent unverified — no task json', g.status); return null; }
            const got = t.parentTask || (t.parentTaskObject && t.parentTaskObject.taskId) || null;
            if (String(got || '') === String(parentId)) { LOG('book: bucket subtask parent OK', taskId, '→', parentId); return got; }
            LOG('book: bucket subtask NOT ATTACHED —', taskId, name, 'came back parentTask=' + JSON.stringify(got) +
                '; it is top-level. Drag it under "' + parentName + '" in Rocketlane — PUT /tasks cannot re-parent.');
            return got;
        } catch (err) { LOG('book: subtask parent check failed', String(err)); }
        return null;
    }
    // Append one dated section to a bucket subtask's Description after booking onto it — the subtask
    // doubles as the plant's visit log ("what did we do there, when"), since these plants have no
    // project of their own (v4.106). PUT /tasks/{id} accepts a partial body with just taskDescription
    // (HTML, per the public API docs). Idempotent per date+category (v4.107): the activity always
    // starts with its category tag ("Integration: …"), so re-running a day whose generated text
    // drifted (commit correlation is not byte-stable) updates nothing instead of near-duplicating.
    // Any failure only logs — the time entry is already booked and must not be affected.
    // Returns true only when a section was actually appended.
    async function _bucketSubtaskDescribeNow(taskId, iso, act, notes) {
        try {
            const g = await rlFetch('GET', `/tasks/${taskId}`);
            const t = g.json && (g.json.taskId ? g.json
                : g.json.data && g.json.data.taskId ? g.json.data
                : g.json.task && g.json.task.taskId ? g.json.task : null);
            if (!t) { LOG('book: describe skipped — no task json', g.status, g.json ? 'keys: ' + Object.keys(g.json).join(',') : String(g.error || g.raw || '').slice(0, 80)); return false; }
            const dateNo = escapeHtml(isoToNorwegianDate(iso));
            const bits = [escapeHtml(act)].concat(String(notes || '').split('\n').filter(Boolean).map(escapeHtml));
            const section = `<p><b>${dateNo}</b> — ${bits.join('<br>')}</p>`;
            const cur = String(t.taskDescription || '');
            // One section per booking = per date + category prefix ("<b>30/07/2026</b> — Integration").
            if (cur.includes(`<b>${dateNo}</b> — ${escapeHtml(String(act || '').split(':')[0])}`)) return false;
            const r = await rlFetch('PUT', `/tasks/${taskId}`, { taskDescription: cur + section });
            if (r.status === 200 || r.status === 201) { LOG('book: description +', taskId, isoToNorwegianDate(iso), act); return true; }
            LOG('book: describe PUT failed', r.status, String(r.raw || r.error || '').slice(0, 140));
        } catch (err) { LOG('book: describe failed', String(err)); }
        return false;
    }
    // All description writes go through one chain: two concurrent describes on the SAME subtask
    // (e.g. week-flow backfills of two days hitting one plant) would lost-update each other's
    // GET-then-PUT. Serializing globally costs nothing at this volume (v4.107).
    let _describeChain = Promise.resolve();
    function bucketSubtaskDescribe(taskId, iso, act, notes) {
        const p = _describeChain.then(() => _bucketSubtaskDescribeNow(taskId, iso, act, notes));
        _describeChain = p.catch(() => {});
        return p;
    }
    // Heal missing Description logs whenever a day's plan is reviewed (v4.107). Bucket rows that
    // plan as ⏭ already-booked never reach the book loop — their entry exists (booked before
    // v4.106, or the describe failed that day) — so the visit log would stay missing forever.
    // The existing subtask entry names the task; re-run the idempotent describe on it.
    async function backfillBucketDescriptions(plan, iso) {
        let added = 0;
        try {
            const ex = plan._existing || [];
            for (const e of plan) {
                if (e.status !== 'already-booked' || e.projectId) continue; // bucket rows only
                const pidPfx = String(e.plant_id) + ' ';
                const hit = ex.find(x => x.task && (x.task.taskId || x.task.id)
                    && String(x.task.taskName || x.task.name || '').indexOf(pidPfx) === 0
                    && (!e.categoryId || !x.category || x.category.categoryId === e.categoryId));
                if (hit && await bucketSubtaskDescribe(hit.task.taskId || hit.task.id, iso, e.activityName, e.notes)) added++;
            }
        } catch (err) { LOG('book: describe backfill failed', String(err)); }
        if (added) LOG('book: describe backfill added', added, 'section(s) for', iso);
        return added;
    }
    // Discipline detector: [name, suffix-regex, evidence-keywords]. Calibrated on 37 real plant-day cases
    // across 16 projects (v4.82 deep-dive: match rate 11→15, zero losses): device ORDER-NO prefixes carry
    // discipline (Danfoss 080Z/084B/EKC/AK-CC ⇒ refrigeration, Exhausto/OJ ⇒ ventilation, CGE/EM2 ⇒ energy).
    const TASK_DISCIPLINES = [
        ['refrig', /refrig|kj.l|frys|freez|kulde/, ['refrig', 'kjøl', 'frys', 'ak3', 'da3', 'carel', 'danfoss', 'pls', 'ak-cc', '084b', '080z', 'ekc', 'ak2', 'kulde']],
        ['vent', /vent|vgv|ahu/, ['vent', 'corrigo', 'vgv', 'ahu', 'aggregat', 'exhausto', 'oj ', 'swegon', 'systemair', 'flexit']],
        ['energy', /energ/, ['energ', 'em2', 'cge', 'meter', 'måler']],
        ['wireless', /wireless|tr.dl.s|mqtt/, ['wireless', 'mqtt', 'ruuvi', 'ibs0', 'ing ', 'ing_', 'trådløs']], // IBS/ING/Ruuvi = wireless MQTT sensors
        ['heat', /heat|varme/, ['varme', 'heat', 'fjernvarme']],
        ['machine', /machine|maskin/, ['maskin', 'machine']],
    ];
    function bookNorm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9æøå]+/g, ' ').replace(/\s+/g, ' ').trim(); }
    function bookDiscOf(text) { const t = bookNorm(text); const out = new Set(); for (const d of TASK_DISCIPLINES) if (d[1].test(t)) out.add(d[0]); return out; }
    // Weighted discipline evidence: count DISTINCT keyword hits per discipline (+1 for a regex hit), so
    // "EM270 + CGE" (energy ×2) outweighs a lone "084B…" (refrig ×1) on a mixed day.
    function bookDiscWeights(str) {
        const w = {}; const t = String(str || '').toLowerCase();
        for (const d of TASK_DISCIPLINES) { let n = 0; for (const k of d[2]) if (t.includes(k)) n++; if (d[1].test(bookNorm(t))) n++; if (n) w[d[0]] = n; }
        return w;
    }
    function bookPickWeighted(cands, weights, stripRe, guess) {
        if (!cands.length) return null;
        // Tiebreaks, in order (lexicographic — top candidate must beat #2 somewhere or it's ambiguous):
        //  1. evidence score
        //  2. specificity (v4.89, from the canonical template): "Heating/ VGV" spans TWO disciplines
        //     (heat + vent via "VGV") and used to tie plain "Ventilation" — FEWER named disciplines wins.
        //  3. name over phase (v4.90): a task whose NAME carries the discipline beats one that only
        //     inherits it from its phase/category ("Design: Refrigeration" > "Nytt oversiktsbilde").
        // With `guess` (v4.92, rescue mode): a full tie no longer gives up — the alphabetically first of
        // the tied-top tasks is returned as the best guess (existing task beats a new activity).
        const scored = cands.map(t => {
            let td = bookDiscOf(t.taskName.replace(stripRe, '')), ph = 0;
            if (!td.size && t.phase) { td = bookDiscOf(t.phase); ph = 1; } // "Nytt oversiktsbilde" under phase "Refrigeration and freezing systems"
            let ov = 0; for (const x of td) ov += (weights[x] || 0);
            return { t, ov, nd: td.size, ph };
        }).filter(x => x.ov > 0);
        if (scored.length === 1) return scored[0].t;
        if (scored.length > 1) {
            scored.sort((a, b) => (b.ov - a.ov) || (a.nd - b.nd) || (a.ph - b.ph) || a.t.taskName.localeCompare(b.t.taskName));
            const [a, b] = scored;
            if (guess || a.ov !== b.ov || a.nd !== b.nd || a.ph !== b.ph) return a.t; // fully tied ⇒ ambiguous (unless guessing)
        }
        return null; // ambiguous ⇒ let the fallback decide
    }
    // Sales-order quantity lines ("Per energy meter — 3 pcs", "IWMAC Aftermarket: … price per unit — 26 pcs",
    // "IWMAC Image: System image - Machinery — x3") are price rows, not work packages — they contain
    // discipline words and would pollute the scoring. Covers the "N pcs", "xN"/"N stk" and IWMAC
    // Image/Aftermarket sales-line notations (seen live on 2701, v4.95).
    const BOOK_QTY_TASK_RE = /\b\d+\s*(pcs|stk)\b|price per unit|aftermarket|^iwmac\s+(image|aftermarket)\b|[—–-]\s*x\s?\d+\s*$/i;
    // Checklist/admin rows are never time-booking targets, not even in rescue mode ("Customers approval",
    // "Alarm test", "Close sales order", "Documentation approved", "Project Satisfaction Survey", …).
    const BOOK_CHECKLIST_RE = /approv|godkjen|survey|dokumentasjon|documentation|subscription|abonnement|\border\b|ordre|handover|overlever|quality|kvalitet|\bsales\b|salg|faktur|invoice|received|alarm test|milestone|møte|meeting/i;
    function pickTask(tasks, category, texts, used) {
        tasks = (tasks || []).filter(t => !BOOK_QTY_TASK_RE.test(t.taskName));
        if (!tasks.length) return null;
        // TIERED evidence: device tokens + graphic names are system-level truth; unit NAMES are only a
        // fallback — on MQTT projects the wireless sensors get renamed to "Kjøttdisk"/"Fryserom", which
        // would otherwise drag every day into refrigeration.
        const gStr = (texts.drawingNames || []).join(' ');
        const w1 = bookDiscWeights((texts.tokStr || '') + ' ' + gStr);
        const w2 = bookDiscWeights(texts.uStr || '');
        const tiered = (cands, stripRe) => bookPickWeighted(cands, w1, stripRe) || (Object.keys(w1).length ? null : bookPickWeighted(cands, w2, stripRe));
        // Checklist-state helpers (v4.87): completed tasks are usually not what today's work was.
        // resolve() = evidence over ALL candidates → evidence over OPEN-ONLY (drops ✓-done tasks, often
        // breaking an evidence tie) → exactly one open candidate left ⇒ that's the active work package.
        const singleOpen = (cands) => { const open = cands.filter(t => !t.done); return open.length === 1 ? open[0] : null; };
        const resolve = (cands, stripRe) => tiered(cands, stripRe) || tiered(cands.filter(t => !t.done), stripRe) || singleOpen(cands);
        // v4.91/4.92: creating an activity is the LAST RESORT — a guessed existing task beats a new
        // activity (Thomas's rule). Rank every remaining task by the same discipline evidence (name or
        // phase); checklist/admin rows and tasks already picked for another category are always
        // excluded. `fences` (v4.95) keep other categories' signature tasks out in STAGES — the last
        // fence is relaxed first, so e.g. Setup lands on an Integration task before it would ever touch
        // a Design task. At each fence stage OPEN tasks are tried first, then COMPLETED ones (v4.96 —
        // on finished "Ombygging" projects every task is ✓-done and rescue used to give up: a done
        // "Design: Refrigeration" still beats a new activity, and a done same-category task beats an
        // open other-category one). Order of guesses per pool: evidence winner (ties → alphabetical) →
        // this category's strict-pool tasks → any survivor, the last two ranked by Thomas's discipline
        // order (refrigeration first — his plants are refrigeration-dominant, so a no-evidence Designer
        // day guesses "Design: Refrigeration", not the alphabetical "Design: Energi") then name.
        const rescue = (sigCands, fences) => {
            const ok = t => !BOOK_CHECKLIST_RE.test(t.taskName) && !(used && used.has(t.taskId));
            const wSum = Object.assign({}, w2);
            for (const k in w1) wSum[k] = (wSum[k] || 0) + w1[k];
            const discPri = t => { // index into TASK_DISCIPLINES (name first, else phase); unknown ⇒ last
                let td = bookDiscOf(t.taskName.replace(/^[a-zæøå ]+\s*[:\-]/i, ''));
                if (!td.size) td = bookDiscOf(t.phase || '');
                for (let i = 0; i < TASK_DISCIPLINES.length; i++) if (td.has(TASK_DISCIPLINES[i][0])) return i;
                return TASK_DISCIPLINES.length;
            };
            for (let k = (fences || []).length; k >= 0; k--) {
                const act = (fences || []).slice(0, k);
                for (const wantOpen of [true, false]) {
                    const pool = tasks.filter(t => (wantOpen ? !t.done : t.done) && ok(t) && !act.some(re => re.test(t.taskName)));
                    if (!pool.length) continue;
                    const best = list => list.filter(t => pool.includes(t))
                        .sort((a, b) => (discPri(a) - discPri(b)) || a.taskName.localeCompare(b.taskName))[0] || null;
                    const hit = bookPickWeighted(pool, wSum, /^[a-zæøå ]+\s*[:\-]/i, true) || best(sigCands || []) || best(pool);
                    if (hit) return Object.assign({ rescued: true }, hit);
                }
            }
            return null;
        };
        if (category === CAT_DRAWING) {
            // "Design: X" tasks plus bare Norwegian drawing tasks ("Maskinbilde", "VGV bilde", "Ny maskintegning…",
            // "Nytt oversiktsbilde", "Grafikk", "Skjermbilder", "System Image …").
            const design = tasks.filter(t => /^design\s*[:\-]/i.test(t.taskName) || /bilde|tegning|oversikt|grafikk|graphic|skjerm|visualis|image/i.test(t.taskName));
            const suf = t => bookNorm(t.taskName.replace(/^design\s*[:\-]/i, ''));
            // The changed drawing's NAME beats everything: "Wireless Overview" → task "Design: Wireless overview".
            // Rank exact > task-suffix-contains-name > name-contains-suffix with the LONGEST suffix winning —
            // otherwise a generic "Design: Overview" steals "Wireless Overview" from "Design: Wireless overview".
            for (const name of (texts.drawingNames || [])) {
                const n = bookNorm(name);
                if (!n) continue;
                let hit = design.find(t => suf(t) === n);
                if (!hit) hit = design.find(t => suf(t) && suf(t).includes(n));
                if (!hit) hit = design.filter(t => suf(t) && n.includes(suf(t))).sort((a, b) => suf(b).length - suf(a).length)[0];
                if (hit) return hit;
                // Discipline bridge across languages: graphic "360.001 Ventilasjon" → task "Design: Ventilation".
                const gd = bookDiscOf(name);
                if (gd.size) { const dm = design.filter(t => [...gd].some(x => bookDiscOf(suf(t)).has(x))); if (dm.length === 1) return dm[0]; }
            }
            if (design.length === 1) return design[0];
            // Fences: setup names stay out longest; integration names are relaxed first.
            return resolve(design, /^design\s*[:\-]/i) || rescue(design, [/ak3|scan\b|gateway|\brac\b|nport|server|port\s*forward/i, /integra(?:tion|sjon)/i]);
        }
        if (category === CAT_INTEGRATION) {
            let cands = tasks.filter(t => /^integra(?:tion|sjon)\s*[:\-]/i.test(t.taskName));
            if (!cands.length) // no Integration:-prefixed tasks — bare-discipline or generic commissioning work packages
                cands = tasks.filter(t => /^(refrigeration|ventilation|heating|heat|energy|energi|machine room|wireless)\b/i.test(t.taskName)
                    || /konfig|igangkj|i?driftsett|commission|innregul|integrasjon|oppkobling|programmering|oppstart/i.test(t.taskName));
            if (cands.length === 1) return cands[0];
            // Fences: design names stay out longest; setup names are relaxed first.
            return resolve(cands, /^integra(?:tion|sjon)\s*[:\-]/i) || rescue(cands, [/design|bilde|tegning/i, /ak3|scan\b|gateway|\brac\b|nport|server|port\s*forward/i]);
        }
        if (category === CAT_SETUP_PC) {
            // NPort/Moxa = serial gateway; "Server configured" / "Port forwarding" / "Connection to the
            // plant" (Hardware & Network phases) are gateway-setup work too.
            const c = tasks.filter(t => /(ak3|scan|gateway|rac|nport|server|moxa|router|nettverk|network)\b|port\s*forward|forbindelse|tilkobling|connection/i.test(t.taskName));
            if (c.length === 1) return c[0];
            const hit = resolve(c, /^[a-zæøå ]+[:\-]/i);
            if (hit) return hit;
            // No evidence distinguishes gateway tasks — walk a fixed priority over the OPEN ones instead
            // of giving up (gateway-est name first).
            for (const re of [/gateway/i, /ak3|scan\b/i, /\brac\b/i, /nport|moxa/i, /server/i, /port\s*forward/i, /connection|forbindelse|tilkobling/i, /network|nettverk/i])
                { const t = c.find(x => !x.done && re.test(x.taskName) && !(used && used.has(x.taskId))); if (t) return t; }
            // Fences: design names stay out longest — gateway setup is integration-side work, so an
            // Integration task is the natural second choice ("Setup 18m → Design: Energi" was wrong).
            return rescue(c, [/design|bilde|tegning/i, /integra(?:tion|sjon)/i]);
        }
        return null;
    }

    // Build the day's booking plan: one entry per plant×category (quick checks excluded), with the
    // project resolved by plant-id prefix and the activity text derived from what actually changed.
    // onStep (optional) reports per-plant progress — the what-changed fetches are the slow part on a
    // busy pang, and a silent 5-minute "Loading…" reads as a hang (v4.103, seen live post-full-scan).
    async function buildBookingPlan(visits, iso, onStep) {
        const [projects, cats, existing] = [await rlProjects(false), await rlCategories(), await rlEntriesOn(iso)];
        const plan = [];
        for (let vi = 0; vi < visits.length; vi++) {
            const v = visits[vi];
            onStep && onStep(vi + 1, visits.length, v);
            const split = categorizeVisit(v);
            const bookable = Object.entries(split).filter(([c, m]) => !CAT_NOT_BOOKED.has(c) && Math.round(m) >= 1);
            if (!bookable.length) continue;
            const proj = rlFindProject(projects, v.plant_id);
            const texts = await bookTexts(v);
            const tasks = proj ? await rlTasks(proj.id) : [];
            const racProject = proj ? RAC_RE.test(proj.name) : false;
            const usedTasks = new Set(); // rescue must not book two categories onto the same task
            for (const [cat, min] of bookable) {
                let category = cat;
                let act;
                if (cat === CAT_INTEGRATION) act = 'Integration: ' + (texts.integration || (texts.actionsWork ? texts.actionsWork + ' work' : 'device/DB config'));
                else if (cat === CAT_DRAWING) act = 'Drawing: ' + (texts.drawing || texts.designerSession || 'graphics update in Designer');
                else if (cat === CAT_SETUP_PC) act = 'Setup: AK3 scanner setup';
                else act = CAT_SHORT[cat] + ': plant work';
                // RAC ⇒ the "integration" is really gateway setup: move it to Setup - PC / Gateway.
                if ((texts.racHit || racProject) && cat === CAT_INTEGRATION) {
                    category = CAT_SETUP_PC;
                    act = 'Setup: RAC' + (texts.integration ? ' — ' + texts.integration : ' setup');
                }
                // Prefer an existing project task; the rich text then rides along as the entry's note.
                const task = pickTask(tasks, category, texts, usedTasks);
                if (task) usedTasks.add(task.taskId);
                LOG('book: pick', v.plant_id, category, '→', task ? task.taskName + (task.rescued ? ' (rescue)' : '') : '(new activity)', '· tasks', tasks.length, '· hints', String(texts.hints || '').slice(0, 120));
                const catId = cats[category];
                const dupe = proj && existing.some(e => e.project && e.project.id === proj.id && e.category && e.category.categoryId === catId);
                // A no-project plant already booked into a TEAM BUCKET today (activity "<plant id> …",
                // same category) is done — show ⏭ at PLAN time instead of an armable picker row. The
                // book-time guard always caught this, but the review UI offered a tickbox for work that
                // was already on the sheet (v4.104, seen live after a week booking).
                const bucketDupe = !proj && !!catId && existing.some(e => e.category && e.category.categoryId === catId
                    && (String(e.activityName || '').indexOf(String(v.plant_id) + ' ') === 0
                        || String((e.task && (e.task.taskName || e.task.name)) || e.taskName || '').indexOf(String(v.plant_id) + ' ') === 0));
                // Detailed multi-line notes → the entry's Notes field (category-matched).
                const notes = category === CAT_DRAWING ? (texts.notesDraw || texts.notesActions || '')
                    : category === CAT_SETUP_PC ? ['AK3 scanner setup', texts.racHit ? 'RAC' : '', texts.notesInteg || texts.notesActions || ''].filter(Boolean).join('\n')
                    : (texts.notesInteg || texts.notesActions || ''); // no commits ⇒ describe the session by its tools
                plan.push({
                    plant_id: v.plant_id, plant: v.name || v.plant_id,
                    projectId: proj ? proj.id : null, projectName: proj ? proj.name : null,
                    taskId: task ? task.taskId : null, taskName: task ? task.taskName : null, taskGuess: !!(task && task.rescued),
                    category, categoryId: catId || null, minutes: Math.round(min), activityName: act, notes,
                    status: !proj ? (bucketDupe ? 'already-booked' : 'no-project') : !catId ? 'no-category' : dupe ? 'already-booked' : 'ready',
                });
            }
        }
        plan._dedupeOk = existing._checkOk !== false; // surfaced as a warning banner when the check failed
        plan._existing = existing;                    // for fallback-booking dupe checks at book time
        // Team bucket projects ("Team Kulde Oppgaver", …) — offered as a fallback home for plants that
        // have no Rocketlane project of their own.
        plan._teamProjects = projects.filter(p => /^\s*team\s/i.test(p.name));
        return plan;
    }

    async function bookPlanEntries(plan, iso, onProgress) {
        const creds = rlCreds();
        let ok = 0, fail = 0;
        for (const e of plan) {
            // Fallback rows: a no-project plant the user chose to book into a team bucket project.
            const isFallback = e.status === 'no-project' && e.selected === true && e.fallbackProjectId;
            if (!isFallback && (e.status !== 'ready' || e.selected === false)) continue; // unticked rows stay untouched
            let projectId = e.projectId, taskId = e.taskId, act = e.activityName;
            if (isFallback) {
                projectId = e.fallbackProjectId; taskId = null;
                act = `${e.plant_id} ${e.plant} - ${e.activityName}`; // "<plant id> <plant name> - <activity>"
                // Same plant already booked into this bucket+category today? Skip instead of duplicating.
                // Matches both entry styles: bare activity ("6163 …") and subtask ("6163 - …" task name).
                const ex = plan._existing || [];
                const pidPfx = String(e.plant_id) + ' ';
                const prior = ex.find(x => x.project && x.project.id === projectId && x.category && x.category.categoryId === e.categoryId
                    && (String(x.activityName || '').indexOf(pidPfx) === 0
                        || String((x.task && (x.task.taskName || x.task.name)) || x.taskName || '').indexOf(pidPfx) === 0));
                if (prior) {
                    e.status = 'already-booked';
                    // The entry exists but its Description log may not (booked pre-v4.106) — heal it (v4.107).
                    if (prior.task && (prior.task.taskId || prior.task.id)) await bucketSubtaskDescribe(prior.task.taskId || prior.task.id, iso, e.activityName, e.notes);
                    onProgress && onProgress(e); continue;
                }
                // Bucket keeps an "Oppgaver utenfor Rocketlane" container? Then the entry goes onto the
                // plant's SUBTASK there (found or created: "<plant id> - <plant name>") instead of a bare
                // activity line — Thomas's convention in Team Kulde Oppgaver (v4.105).
                taskId = await ensureBucketSubtask(projectId, e.plant_id, e.plant);
                if (taskId) { e.taskId = taskId; e.taskName = `${e.plant_id} - ${e.plant}`; }
            }
            const body = { date: iso, minutes: e.minutes, billable: true, categoryId: e.categoryId, projectId };
            const notes = e.notes || '';
            if (taskId) { body.taskId = taskId; body.notes = notes || act; } // task entry: details (or the title) → notes
            else { body.activityName = act; if (notes) body.notes = notes; } // activity entry: details → Notes field
            let r = await rlFetch('POST', `/users/${creds.userId}/time-entries`, body);
            // Transient server error (a lone HTTP 502 killed one entry of a 24-entry week, 2026-07-06):
            // a dead gateway may still have COMMITTED the write, so verify before retrying — the entry
            // is retried only when the sheet provably does NOT have it yet (never duplicate).
            if (!(r.status === 200 || r.status === 201) && (r.status >= 500 || r.status === 429 || !r.status)) {
                await new Promise(res => setTimeout(res, 1500));
                _rlWeekCache.clear();
                const now = await rlEntriesOn(iso);
                // Build-time dedupe guarantees the sheet had NO entry for this project+category today,
                // so one appearing now can only be OUR write that the gateway failed to acknowledge.
                const landed = now._checkOk && now.some(x => x.project && x.project.id === projectId
                    && x.category && x.category.categoryId === e.categoryId
                    && (!isFallback
                        || String(x.activityName || '').indexOf(String(e.plant_id) + ' ') === 0
                        || (taskId && x.task && (x.task.taskId === taskId || x.task.id === taskId))));
                if (landed) r = { status: 201, json: null };
                else if (now._checkOk) r = await rlFetch('POST', `/users/${creds.userId}/time-entries`, body);
                // check unavailable ⇒ leave the failure — a rebuilt plan dedupes correctly later
            }
            e.status = (r.status === 200 || r.status === 201) ? 'booked' : 'failed';
            if (e.status === 'booked') ok++; else {
                fail++;
                const err0 = (r.json && r.json.errors && r.json.errors[0]) || {};
                e.error = err0.errorMessage || err0.reason || (r.json && r.json.message) || ('HTTP ' + r.status);
            }
            // Bucket-subtask entries also log the day's work into the subtask's Description (v4.106).
            if (e.status === 'booked' && isFallback && taskId) await bucketSubtaskDescribe(taskId, iso, e.activityName, e.notes);
            onProgress && onProgress(e);
        }
        _rlWeekCache.clear(); // fresh dedupe data on the next plan build — we just changed the sheet
        return { ok, fail };
    }

    // The confirm-then-book flow, rendered inside the .catsum container.
    function openBookingFlow(container, visits, iso) {
        const saved = container.innerHTML;
        container.innerHTML = '<div class="bookplan"><div class="bookplan-head">⤴ Book to timesheet — building plan…</div></div>';
        const box = container.querySelector('.bookplan');
        const esc = escapeHtml;
        buildBookingPlan(visits, iso).then(plan => {
            if (!plan.length) { box.innerHTML = '<div class="bookplan-head">Nothing bookable for this date.</div><div class="bookplan-foot"><button type="button" data-b="cancel">Close</button></div>'; wire(); return; }
            const ready = plan.filter(e => e.status === 'ready');
            const teamProjects = plan._teamProjects || [];
            const rememberedFallback = GM_getValue('book_fallback_project', 0);
            const teamOpts = teamProjects.map(p => `<option value="${p.id}"${p.id === rememberedFallback ? ' selected' : ''}>${esc(p.name)}</option>`).join('');
            // Bookable rows get a real CHECKBOX (ticked by default) — untick what you don't want synced.
            // No-project rows get an UNTICKED checkbox + a team-bucket picker: choose a project to book
            // the plant there as "<plant id> <plant name> - <activity>".
            const lines = plan.map((e, i) =>
                `<div class="bookplan-row" data-i="${i}">
                    <span class="bookplan-st">${e.status === 'ready' ? '<input type="checkbox" class="bookplan-cb" checked title="Untick to skip this entry">'
                        : (e.status === 'no-project' && teamOpts) ? `<input type="checkbox" class="bookplan-cb" data-fallback="1"${rememberedFallback ? '' : ' disabled'} title="Tick to book into the selected team project">`
                        : e.status === 'already-booked' ? '⏭' : '⚠'}</span>
                    <span class="bookplan-txt" ${e.notes ? `title="Notes:\n${esc(e.notes)}"` : ''}><b>${esc(String(e.plant_id))}</b> ${esc(e.plant)} · ${esc(CAT_SHORT[e.category] || e.category)} <b>${fmtMinutes(e.minutes)}</b><br>
                    <small>${e.taskName ? '📌 task' + (e.taskGuess ? ' <i>(best guess)</i>' : '') + ': <b>' + esc(e.taskName) + '</b> · note: ' + esc(e.activityName) : '✳ new activity: ' + esc(e.activityName)}${e.projectName ? ' → ' + esc(e.projectName) : ''}${e.status === 'already-booked' ? ' — already booked (skipped)' : e.status === 'no-category' ? ' — category missing in Rocketlane' : ''}</small>${e.status === 'no-project' ? (teamOpts ? `<br><small>no own project — book into: <select class="bookplan-proj"><option value="">choose team project…</option>${teamOpts}</select></small>` : '<br><small>— no matching project, book manually</small>') : ''}</span>
                </div>`).join('');
            const warn = plan._dedupeOk === false ? '<div class="bookplan-warn">⚠ Couldn\'t check what\'s already booked on this date — entries may duplicate. Check the sheet before booking.</div>' : '';
            box.innerHTML = `<div class="bookplan-head">⤴ Book ${isoToNorwegianDate(iso)} — ${ready.length} entr${ready.length === 1 ? 'y' : 'ies'} to create</div>${warn}${lines}
                <div class="bookplan-foot"><button type="button" data-b="go" ${ready.length ? '' : 'disabled'}>Book ${ready.length} entr${ready.length === 1 ? 'y' : 'ies'}</button><button type="button" data-b="cancel">Cancel</button></div>`;
            wire();
            backfillBucketDescriptions(plan, iso); // ⏭ bucket rows: heal missing Description logs in the background (v4.107)
            function wire() {
                const updateGo = () => {
                    const n = [...box.querySelectorAll('.bookplan-cb')].filter(c => c.checked).length;
                    const go = box.querySelector('[data-b=go]');
                    if (go) { go.disabled = n === 0; go.textContent = `Book ${n} entr${n === 1 ? 'y' : 'ies'}`; }
                };
                box.querySelectorAll('.bookplan-cb').forEach(cb => cb.addEventListener('change', updateGo));
                // Team-bucket picker: choosing a project arms + ticks the row; clearing it disarms.
                box.querySelectorAll('.bookplan-proj').forEach(sel => sel.addEventListener('change', (ev) => {
                    const row = ev.target.closest('.bookplan-row');
                    const cb = row && row.querySelector('.bookplan-cb');
                    const val = +ev.target.value || 0;
                    if (cb) { cb.disabled = !val; cb.checked = !!val; }
                    if (val) GM_setValue('book_fallback_project', val); // remembered as next time's default
                    updateGo();
                }));
                box.querySelector('[data-b=cancel]')?.addEventListener('click', () => { container.innerHTML = saved; rewire(container, visits, iso); });
                box.querySelector('[data-b=go]')?.addEventListener('click', async (ev) => {
                    ev.currentTarget.disabled = true; ev.currentTarget.textContent = 'Booking…';
                    // Freeze the selection: unticked rows are skipped (and their boxes locked).
                    box.querySelectorAll('.bookplan-row').forEach(row => {
                        const idx = +row.dataset.i, cb = row.querySelector('.bookplan-cb');
                        if (cb && plan[idx]) { plan[idx].selected = cb.checked; cb.disabled = true; }
                        const sel = row.querySelector('.bookplan-proj');
                        if (sel && plan[idx]) {
                            plan[idx].fallbackProjectId = +sel.value || null;
                            plan[idx].fallbackProjectName = sel.value ? sel.options[sel.selectedIndex].text : null;
                            sel.disabled = true;
                        }
                    });
                    await bookPlanEntries(plan, iso, (e) => {
                        const i = plan.indexOf(e);
                        const st = box.querySelector(`.bookplan-row[data-i="${i}"] .bookplan-st`);
                        if (st) st.textContent = e.status === 'booked' ? '✅' : e.status === 'already-booked' ? '⏭' : '❌';
                        if (e.status === 'failed') { const tx = box.querySelector(`.bookplan-row[data-i="${i}"] small`); if (tx) tx.textContent += ' — ' + e.error; }
                    });
                    const okN = plan.filter(e => e.status === 'booked').length;
                    const failN = plan.filter(e => e.status === 'failed').length;
                    const skipN = plan.filter(e => e.status === 'ready' && e.selected === false).length;
                    const foot = box.querySelector('.bookplan-foot');
                    foot.innerHTML = `<span class="bookplan-sum">${okN} booked${failN ? ` · ${failN} failed` : ''}${skipN ? ` · ${skipN} left unticked` : ''} — reload the timesheet page to see them</span><button type="button" data-b="cancel">Close</button>`;
                    foot.querySelector('[data-b=cancel]').addEventListener('click', () => { container.innerHTML = saved; rewire(container, visits, iso); });
                });
            }
        }).catch(err => {
            box.innerHTML = `<div class="bookplan-head">Couldn't build the plan: ${esc(String(err && err.message || err))}</div><div class="bookplan-foot"><button type="button" data-b="cancel">Close</button></div>`;
            box.querySelector('[data-b=cancel]').addEventListener('click', () => { container.innerHTML = saved; rewire(container, visits, iso); });
        });
    }
    // Restoring saved HTML loses listeners — just re-render the summary properly.
    function rewire(container, visits, iso) { renderCategorySummary(container, visits, iso); }

    // ===== ⤴ Book week — one click fills Monday–Friday (v4.93) =====================================
    // Toolbar button injected left of Rocketlane's own "Add": builds a booking plan for every weekday
    // (cached scan if available, else a quick recent+footprint scan), distributes each day to the
    // workday total (default 7,5 h) across its bookable plants, and books after one review. Duplicate
    // safety: per-day server dedupe (project+category already on that date ⇒ ⏭), and a day whose
    // existing-entries check failed is NOT bookable at all — never risk a double entry.
    function mondayOfISO(iso) {
        const d = new Date(iso + 'T12:00:00');
        d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Mon=0 … Sun=6
        return d.toISOString().slice(0, 10);
    }
    function addDaysISO(iso, n) {
        const d = new Date(iso + 'T12:00:00');
        d.setDate(d.getDate() + n);
        return d.toISOString().slice(0, 10);
    }
    // Book week must stand on FULL-scan data (v4.101, Thomas's rule): quick scans only cover recent +
    // footprint plants and can miss plant-admin/designer visits — booking a week from them would both
    // drop plants and mis-distribute the 7,5 h. ONE full scan caches EVERY date it finds, so a single
    // sweep covers all missing weekdays at once. A RECENT cache is trusted as-is (v4.102, Thomas):
    // past days never re-scan, and today's cache only re-scans when older than 3 h (more of the day
    // has happened since) — a fresh scan from the panel or a previous Book week is never repeated.
    const WEEK_TODAY_MAX_AGE_MS = 3 * 3600000;
    async function weekEnsureAllPlants(statusCb) {
        const all = GM_getValue(KEY_ALL_PLANTS, []) || [];
        if (all.length >= FULL_INVENTORY_MIN) return all;
        statusCb && statusCb('Loading the full plant inventory from pang… (opens pang briefly, one-time)');
        await autoSyncFromPang(45000, [], true); // foreground harvest: reliable, unlike a throttled background tab
        return GM_getValue(KEY_ALL_PLANTS, []) || [];
    }
    async function weekEnsureFullScan(mondayIso, statusCb) {
        const username = effectiveUsername();
        if (!username) return { ok: false, reason: 'pang user unknown — open pang once' };
        const today = todayISO();
        const need = [];
        for (let i = 0; i < 5; i++) {
            const iso = addDaysISO(mondayIso, i);
            if (iso > today) continue; // future — nothing to scan
            const c = readCache(username, iso);
            if (!c || (iso === today && Date.now() - (c.scanned_at || 0) > WEEK_TODAY_MAX_AGE_MS)) need.push(iso);
        }
        if (!need.length) return { ok: true, ran: false };
        let plantIds = (await weekEnsureAllPlants(statusCb)).map(String);
        if (!plantIds.length) return { ok: false, reason: 'plant inventory unavailable' };
        // Footprint-first ordering (same as the panel's Full scan): pure reordering, identical result.
        const pri = new Set([
            ...((GM_getValue(KEY_KNOWN_PLANTS, []) || []).map(String)),
            ...(((GM_getValue(KEY_USER_PLANTS, {})[username]) || []).map(String)),
        ]);
        const head = [], tail = [];
        for (const id of plantIds) (pri.has(id) ? head : tail).push(id);
        plantIds = [...head, ...tail];
        const all = await loadUserHistoryAllDates(plantIds, need[0], (done, total) =>
            statusCb && statusCb(`Full scan (${need.length} day${need.length === 1 ? '' : 's'} uncached) — ${done} of ${total} plants…`));
        if (!all.username) return { ok: false, reason: 'could not identify your pang user in the scan' };
        rememberUserPlants(all.username, [].concat(...Object.values(all.dates || {})));
        if (!all.failed) writeCacheDates(all.username, all.dates, all.scanned); // partial scans are never cached (silent holes)
        return { ok: true, ran: true, failed: all.failed || 0, dates: all.dates || {}, scanned: all.scanned };
    }
    // Load one day's visits ready for booking: full-scan cache when present (instant + complete),
    // else a quick scan over recent + footprint plants; then names, commit enrichment, and the
    // 7,5 h distribution over bookable (non-quick-check) plants.
    async function loadDayForBooking(iso, onProg, overrideDates, statusCb) {
        if (iso > todayISO()) return []; // future days can't have plant work — never burn a scan on them (v4.94)
        const username = effectiveUsername();
        let visits;
        const cached = username ? readCache(username, iso) : null;
        if (overrideDates) visits = (overrideDates[iso] || []).map(v => ({ ...v })); // fresh full scan that couldn't be cached (partial)
        else if (cached) visits = cached.visits.map(v => ({ ...v }));
        else {
            const recent = (GM_getValue(KEY_KNOWN_PLANTS, []) || []).map(String);
            const mine = ((GM_getValue(KEY_USER_PLANTS, {})[username]) || []).map(String);
            const plantIds = [...new Set([...recent, ...mine])];
            if (!plantIds.length) return [];
            visits = (await loadVisitsForDate(iso, plantIds, onProg)).visits || [];
        }
        if (!visits.length) return visits;
        const missing = visits.filter(v => !v.name).map(v => v.plant_id);
        if (missing.length) {
            statusCb && statusCb(`looking up ${missing.length} plant name${missing.length === 1 ? '' : 's'}…`);
            try { await fetchMissingPlantNames(missing, null); } catch (e) { /* names are cosmetic */ }
            const names = GM_getValue(KEY_PLANT_NAMES, {});
            for (const v of visits) if (!v.name) v.name = cachedPlantName(names, v.plant_id) || v.name;
        }
        statusCb && statusCb(`correlating config commits for ${visits.length} plant${visits.length === 1 ? '' : 's'}…`);
        await enrichVisitsWithCommits(visits, iso);
        for (const v of visits) v.normalized_minutes = null;
        const hours = GM_getValue(KEY_WORKDAY_HOURS, DEFAULT_WORKDAY_HOURS) || DEFAULT_WORKDAY_HOURS;
        const bookable = visits.filter(v => categorizeVisit(v)[CAT_CHECK] == null);
        if (bookable.length) normalizeMinutes(bookable, Math.round(hours * 60), ROUND_TO_MIN);
        return visits;
    }
    function toggleWeekBooking() {
        const ex = document.getElementById(WEEK_ID);
        if (ex) { ex.remove(); return; }
        openWeekBooking();
    }
    function openWeekBooking() {
        const wrap = document.createElement('div');
        wrap.id = WEEK_ID;
        wrap.innerHTML = '<div class="bookplan"></div>';
        document.body.appendChild(wrap);
        const box = wrap.querySelector('.bookplan');
        const esc = escapeHtml;
        const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
        let seq = 0;
        // Start on the week of the panel's selected date when the panel is open, else the current week.
        const panelDate = document.querySelector(`#${PANEL_ID} input[type=date]`);
        let monday = mondayOfISO((panelDate && panelDate.value) || todayISO());

        const headHtml = () => `<div class="bookplan-head">⤴ Book week ${isoToNorwegianDate(monday)} – ${isoToNorwegianDate(addDaysISO(monday, 4))}
            <span class="rl-week-nav"><button type="button" data-b="prev" title="Previous week">‹</button><button type="button" data-b="next" title="Next week">›</button><button type="button" data-b="cancel" title="Close">✕</button></span></div>`;
        const wireNav = () => {
            box.querySelector('[data-b=prev]')?.addEventListener('click', () => { monday = addDaysISO(monday, -7); build(); });
            box.querySelector('[data-b=next]')?.addEventListener('click', () => { monday = addDaysISO(monday, 7); build(); });
            box.querySelectorAll('[data-b=cancel]').forEach(b => b.addEventListener('click', () => wrap.remove()));
        };

        async function build() {
            const mySeq = ++seq;
            box.innerHTML = headHtml() + '<div class="rl-week-status">Building plans…</div>';
            wireNav();
            const statusEl = () => box.querySelector('.rl-week-status');
            // Full-scan gate (v4.101): the week's plans must come from FULL-scan data — run one scan
            // covering every uncached weekday before building. Quick data is only ever the fallback
            // when the scan itself is impossible, and then it's flagged loudly.
            let weekWarn = '', override = null;
            try {
                const fs = await weekEnsureFullScan(monday, msg => { const s = statusEl(); if (s && seq === mySeq) s.textContent = msg; });
                if (seq !== mySeq) return;
                if (!fs.ok) weekWarn = `⚠ Full scan unavailable (${esc(fs.reason)}) — built from quick data, plans may MISS plants.`;
                else if (fs.ran && fs.failed) { weekWarn = `⚠ ${fs.failed} plant${fs.failed === 1 ? '' : 's'} unreachable during the full scan — using the partial result (not cached).`; override = fs.dates; }
            } catch (err) {
                if (seq !== mySeq) return;
                weekWarn = `⚠ Full scan failed (${esc(String((err && err.message) || err))}) — built from quick data, plans may MISS plants.`;
            }
            const days = [];
            for (let i = 0; i < 5; i++) {
                const iso = addDaysISO(monday, i);
                const st = statusEl();
                if (seq !== mySeq) return;
                if (st) st.textContent = `Loading ${WD[i]} ${isoToNorwegianDate(iso)} (${i + 1}/5)…`;
                try {
                    const dayLabel = `${WD[i]} ${isoToNorwegianDate(iso)} (${i + 1}/5)`;
                    const say = txt => { const s = statusEl(); if (s && seq === mySeq) s.textContent = `${dayLabel} — ${txt}`; };
                    const visits = await loadDayForBooking(iso,
                        (done, total) => say(`scanning ${done} of ${total} plants…`), override, say);
                    if (seq !== mySeq) return;
                    const plan = visits.length ? await buildBookingPlan(visits, iso,
                        (n, total, v) => say(`reading what changed — plant ${n} of ${total} (${v.plant_id})…`)) : [];
                    days.push({ iso, wd: WD[i], plan });
                    if (plan.length) backfillBucketDescriptions(plan, iso); // heal ⏭ bucket rows; serialized internally (v4.107)
                } catch (err) {
                    days.push({ iso, wd: WD[i], plan: [], err: String((err && err.message) || err) });
                }
            }
            if (seq !== mySeq) return;
            render(days, weekWarn);
        }

        function render(days, weekWarn) {
            const rows = []; // flat index across all days: { e, day }
            // Team-bucket picker for no-project plants — same flow as ⤴ Book day (v4.97): choose a
            // "Team … Oppgaver" project, the row arms, and it books there as "<plant id> <plant> - <activity>".
            const teamProjects = (days.find(d => d.plan && d.plan._teamProjects && d.plan._teamProjects.length) || { plan: {} }).plan._teamProjects || [];
            const rememberedFallback = GM_getValue('book_fallback_project', 0);
            const teamOpts = teamProjects.map(p => `<option value="${p.id}"${p.id === rememberedFallback ? ' selected' : ''}>${esc(p.name)}</option>`).join('');
            let html = '';
            for (const day of days) {
                const unsafe = day.plan._dedupeOk === false; // can't see what's already booked ⇒ never book this day
                const ready = day.plan.filter(e => e.status === 'ready');
                const already = day.plan.filter(e => e.status === 'already-booked').length;
                const noCat = day.plan.filter(e => e.status === 'no-category').length;
                const mins = ready.reduce((s, e) => s + e.minutes, 0);
                const side = day.err ? '⚠ ' + esc(day.err)
                    : !day.plan.length ? 'no plant work'
                    : unsafe ? '⚠ can’t verify what’s booked — day skipped'
                    : `${ready.length ? `${ready.length} to book · ${fmtMinutes(mins)}` : 'nothing new'}${already ? ` · ⏭ ${already} already booked` : ''}${noCat ? ` · ⚠ ${noCat} missing category — flip ‹ › to retry` : ''}`;
                html += `<div class="rl-week-day">${day.wd} ${isoToNorwegianDate(day.iso)} <small>${side}</small></div>`;
                if (unsafe) continue;
                for (const e of day.plan) {
                    const i = rows.length;
                    rows.push({ e, day });
                    html += `<div class="bookplan-row" data-i="${i}">
                        <span class="bookplan-st">${e.status === 'ready' ? '<input type="checkbox" class="bookplan-cb" checked title="Untick to skip this entry">'
                            : (e.status === 'no-project' && teamOpts) ? `<input type="checkbox" class="bookplan-cb" data-fallback="1"${rememberedFallback ? '' : ' disabled'} title="Tick to book into the selected team project">`
                            : e.status === 'already-booked' ? '⏭' : '⚠'}</span>
                        <span class="bookplan-txt" ${e.notes ? `title="Notes:\n${esc(e.notes)}"` : ''}><b>${esc(String(e.plant_id))}</b> ${esc(e.plant)} · ${esc(CAT_SHORT[e.category] || e.category)} <b>${fmtMinutes(e.minutes)}</b><br>
                        <small>${e.taskName ? '📌 task' + (e.taskGuess ? ' <i>(best guess)</i>' : '') + ': <b>' + esc(e.taskName) + '</b>' : '✳ new activity: ' + esc(e.activityName)}${e.status === 'already-booked' ? ' — already booked' : ''}</small>${e.status === 'no-project' ? (teamOpts ? `<br><small>no own project — book into: <select class="bookplan-proj"><option value="">choose team project…</option>${teamOpts}</select></small>` : '<br><small>— no matching project, book manually</small>') : ''}</span>
                    </div>`;
                }
            }
            const readyRows = rows.filter(r => r.e.status === 'ready');
            box.innerHTML = headHtml() + (weekWarn ? `<div class="bookplan-warn">${weekWarn}</div>` : '') + html +
                `<div class="bookplan-foot"><button type="button" data-b="go" ${readyRows.length ? '' : 'disabled'}>Book ${readyRows.length} entr${readyRows.length === 1 ? 'y' : 'ies'}</button><button type="button" data-b="cancel">Close</button></div>`;
            wireNav();
            const updateGo = () => {
                const n = [...box.querySelectorAll('.bookplan-cb')].filter(c => c.checked).length;
                const go = box.querySelector('[data-b=go]');
                if (go) { go.disabled = n === 0; go.textContent = `Book ${n} entr${n === 1 ? 'y' : 'ies'}`; }
            };
            box.querySelectorAll('.bookplan-cb').forEach(cb => cb.addEventListener('change', updateGo));
            // Team-bucket picker: choosing a project arms + ticks the row; clearing it disarms (as in Book day).
            box.querySelectorAll('.bookplan-proj').forEach(sel => sel.addEventListener('change', (ev) => {
                const row = ev.target.closest('.bookplan-row');
                const cb = row && row.querySelector('.bookplan-cb');
                const val = +ev.target.value || 0;
                if (cb) { cb.disabled = !val; cb.checked = !!val; }
                if (val) GM_setValue('book_fallback_project', val); // remembered as next time's default
                updateGo();
            }));
            box.querySelector('[data-b=go]')?.addEventListener('click', async (ev) => {
                ev.currentTarget.disabled = true; ev.currentTarget.textContent = 'Booking…';
                box.querySelector('[data-b=prev]')?.setAttribute('disabled', '');
                box.querySelector('[data-b=next]')?.setAttribute('disabled', '');
                // Freeze the selection, then book day by day.
                box.querySelectorAll('.bookplan-row').forEach(rowEl => {
                    const idx = +rowEl.dataset.i, cb = rowEl.querySelector('.bookplan-cb');
                    if (cb && rows[idx]) { rows[idx].e.selected = cb.checked; cb.disabled = true; }
                    const sel = rowEl.querySelector('.bookplan-proj');
                    if (sel && rows[idx]) {
                        rows[idx].e.fallbackProjectId = +sel.value || null;
                        rows[idx].e.fallbackProjectName = sel.value ? sel.options[sel.selectedIndex].text : null;
                        sel.disabled = true;
                    }
                });
                const onOne = (e) => {
                    const i = rows.findIndex(r => r.e === e);
                    if (i < 0) return;
                    const st = box.querySelector(`.bookplan-row[data-i="${i}"] .bookplan-st`);
                    if (st) st.textContent = e.status === 'booked' ? '✅' : e.status === 'already-booked' ? '⏭' : '❌';
                    if (e.status === 'failed') { const tx = box.querySelector(`.bookplan-row[data-i="${i}"] small`); if (tx) tx.textContent += ' — ' + e.error; }
                };
                for (const day of new Set(rows.map(r => r.day))) {
                    if (day.plan._dedupeOk === false) continue; // belt & braces — these rows were never rendered
                    await bookPlanEntries(day.plan, day.iso, onOne);
                }
                const all = rows.map(r => r.e);
                const okN = all.filter(e => e.status === 'booked').length;
                const failN = all.filter(e => e.status === 'failed').length;
                const skipN = all.filter(e => e.status === 'ready' && e.selected === false).length;
                const foot = box.querySelector('.bookplan-foot');
                foot.innerHTML = `<span class="bookplan-sum">${okN} booked${failN ? ` · ${failN} failed` : ''}${skipN ? ` · ${skipN} left unticked` : ''} — reload the timesheet page to see them</span><button type="button" data-b="cancel">Close</button>`;
                foot.querySelector('[data-b=cancel]').addEventListener('click', () => wrap.remove());
            });
        }

        build();
    }
    // Toolbar button, left of Rocketlane's own "Add" — borrows its classes so it matches the UI.
    let _lastWeekBtnScan = 0;
    function buildWeekButton() {
        if (document.getElementById(WEEK_BTN_ID)) return;
        const now = Date.now();
        if (now - _lastWeekBtnScan < 800) return; // the SPA mutates constantly — don't rescan every tick
        _lastWeekBtnScan = now;
        const btns = [...document.querySelectorAll('button')];
        const addBtn = btns.find(b => b.textContent.trim().toLowerCase() === 'add' && b.offsetParent)
            || btns.find(b => /^add\b/i.test(b.textContent.trim()) && b.textContent.trim().length <= 8 && b.offsetParent);
        if (!addBtn) return; // toolbar not rendered yet — the MutationObserver retries
        const btn = document.createElement('button');
        btn.id = WEEK_BTN_ID;
        btn.type = 'button';
        btn.className = addBtn.className;
        btn.style.marginRight = '8px';
        btn.textContent = '⤴ Book week';
        btn.title = 'Fill Monday–Friday from your IWMAC day recaps: 7,5 h per day split across the plants you worked, booked onto existing tasks. Anything already on the sheet is skipped — never duplicates.';
        btn.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); toggleWeekBooking(); });
        addBtn.parentElement.insertBefore(btn, addBtn);
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
                    <div class="catrow">${categoryChips(v)}</div>
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
        document.getElementById(WEEK_BTN_ID)?.remove();
        document.getElementById(WEEK_ID)?.remove();
    }

    function syncRocketlaneUi() {
        if (!isRocketlaneTimesheetsPage()) {
            removeRocketlaneUi();
            return;
        }
        injectStyle();
        buildButton();
        buildWeekButton();
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