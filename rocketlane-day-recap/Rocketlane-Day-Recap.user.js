// ==UserScript==
// @name         Rocketlane Day Recap
// @version      4.134
// @description  On Rocketlane My Timesheet, pick a date and see all IWMAC plants you visited that day, plus a 🔧 badge when the plant's config changed during your visit, and a 📋 "Day by category" timesheet roll-up. Reads IWMAC All logs (one query per day, incl. notes and operations-log entries) with pang's get_history as the fallback, plus the changes/commits APIs.
// @namespace    https://github.com/hapnes-dev/tampermonkey-scripts
// @homepageURL  https://github.com/hapnes-dev/tampermonkey-scripts
// @updateURL    https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/rocketlane-day-recap/Rocketlane-Day-Recap.user.js
// @downloadURL  https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/rocketlane-day-recap/Rocketlane-Day-Recap.user.js
// @match        https://kiona.rocketlane.com/timesheets/*
// @match        http://*.plants.iwmac.local:8080/*
// @match        https://*.plants.iwmac.local:8080/*
// @match        http://tools.iwmac.local/pang.qxs*
// @match        https://tools.iwmac.local/pang.qxs*
// @match        https://outlook.office.com/*
// @match        https://outlook.office365.com/*
// @match        https://outlook.cloud.microsoft/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @grant        GM_openInTab
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @connect      tools.iwmac.local
// @connect      internal.iwmac.local
// @connect      iwmac.local
// @connect      *
// @run-at       document-idle
// ==/UserScript==

// ===== IWMAC "All logs" helpers ======================================================
// Pure, side-effect-free helpers for the All logs feed (http://internal.iwmac.local/tools/all_logs/).
// They live OUTSIDE the userscript IIFE so `node --test all-logs-helpers.test.js` can require this
// file directly: the IIFE returns immediately when GM_xmlhttpRequest is absent, so requiring the file
// under Node never touches location/GM storage. Everything below is deliberately dependency-free.
var RL_RECAP_ALL_LOGS = (function () {
    'use strict';

    // Never print a secret VALUE anywhere a note can end up (chip tooltip, timesheet note, console).
    // Shared with bookTexts inside the IIFE — one definition, one behaviour. Live handover notes have
    // been seen carrying plant passwords verbatim — including as "PW: …" (found on a real 2026-08-27
    // note, v4.115), which the original list missed. \bpw\b is word-bounded so "pwm" stays clean.
    const ALL_LOGS_SECRET_RE = /pass|pwd|secret|token|key|\bpw\b/i;
    const ALL_LOGS_NOTE_CAP = 8;      // notes shown per plant — a busy day should not bury the row
    const ALL_LOGS_NOTE_CHARS = 180;  // one note line; longer comments are ellipsised

    // Same normalisation the IIFE's normalizeUser does (lowercase, strip @domain). Duplicated on
    // purpose so the helpers stay require-able without the browser half of the script.
    function rlRecapNormalizeUser(u) {
        return String(u || '').toLowerCase().split('@')[0].trim();
    }

    // The pang click log is mirrored into All logs as system PANG1 (older rows: PANG). Those rows carry
    // the same action codes the recap already knows — their `comment` is only "Launch <tool>", never
    // extra detail, so PANG1 comments must never become activity notes.
    function isPang1LogSystem(sys) {
        return /^PANG1?$/i.test(String(sys || ''));
    }

    // The action-chip code for one All logs row. PANG1 keeps its pang action code (so existing
    // ACTION_META labels apply); NOTES becomes the synthetic `pang_note`; anything else uses its own
    // action, falling back to the lowercased system name when the row has no action.
    function allLogsChipCode(rec) {
        const sys = rec && rec.system;
        if (isPang1LogSystem(sys)) return (rec && rec.action) || '';
        if (/^NOTES$/i.test(String(sys || ''))) return 'pang_note';
        return (rec && rec.action) || String(sys || '').toLowerCase();
    }

    // service.php takes a wall-clock window, so one calendar day is 00:00:00 … 23:59:59 local (Oslo),
    // matching every other date in the script.
    function allLogsDateWindow(iso) {
        return { date_from: iso + ' 00:00:00', date_to: iso + ' 23:59:59' };
    }

    // Make one log comment safe to display. A comment that looks like it carries a credential is
    // reduced to "[redacted]" plus any URLs it contained (the Zendesk/ticket link is the useful part
    // and is never itself the secret).
    function maskAllLogsComment(s) {
        s = String(s == null ? '' : s).trim();
        if (!s) return '';
        const urls = s.match(/https?:\/\/[^\s]+/gi) || [];
        if (ALL_LOGS_SECRET_RE.test(s)) s = '[redacted]' + (urls.length ? ' ' + urls.join(' ') : '');
        s = s.replace(/\s+/g, ' ').trim();
        if (s.length > ALL_LOGS_NOTE_CHARS) s = s.slice(0, ALL_LOGS_NOTE_CHARS - 1) + '…';
        return s;
    }

    // Keep only this user's rows that name a plant. The request already filters by exact user, but a
    // substring match on the server (or a shared session) must never leak another Thomas into the day.
    function filterAllLogsRecords(records, username) {
        const me = rlRecapNormalizeUser(username);
        if (!me) return [];
        return (records || []).filter(r => r && String(r.plant_id || '').trim() && rlRecapNormalizeUser(r.user) === me);
    }

    // Build recap visits straight from All logs rows. Shape matches loadVisitsForDate's output minus
    // the time fields — the caller stamps those, so both sources go through the identical estimator.
    // `tsFn` converts "YYYY-MM-DD HH:MM:SS" to ms (the IIFE passes tsFromPangDate).
    function visitsFromAllLogsRecords(records, username, names, tsFn) {
        const toTs = tsFn || (s => new Date(String(s || '').replace(' ', 'T')).getTime());
        const rows = filterAllLogsRecords(records, username);
        const byPlant = new Map();
        for (const r of rows) {
            const pid = String(r.plant_id).trim();
            let g = byPlant.get(pid);
            if (!g) { g = { pang1: [], extra: [] }; byPlant.set(pid, g); }
            (isPang1LogSystem(r.system) ? g.pang1 : g.extra).push(r);
        }
        const visits = [];
        for (const [pid, g] of byPlant) {
            const hasClicks = g.pang1.length > 0;
            const events = [];
            for (const r of g.pang1) {
                const ts = toTs(r.date);
                if (isFinite(ts)) events.push({ ts, action: allLogsChipCode(r), click: true });
            }
            for (const r of g.extra) {
                const ts = toTs(r.date);
                // A non-click row (a note, an operations-log entry) is evidence the plant was worked on,
                // but it is not a pang click — counting it as one would push a real session past
                // SPARSE_CLICK_MAX and disable the commit fusion. Only when the plant has NO pang clicks
                // at all do these rows stand in as the visit's clicks.
                if (isFinite(ts)) events.push({ ts, action: allLogsChipCode(r), click: !hasClicks });
            }
            if (!events.length) continue;
            events.sort((a, b) => a.ts - b.ts);
            const actions = [...new Set(events.map(e => e.action).filter(Boolean))];
            const action_counts = {};
            for (const e of events) if (e.action) action_counts[e.action] = (action_counts[e.action] || 0) + 1;
            const notes = [];
            for (const r of g.extra.slice().sort((a, b) => toTs(a.date) - toTs(b.date))) {
                const m = maskAllLogsComment(r.comment);
                if (m && notes.indexOf(m) === -1 && notes.length < ALL_LOGS_NOTE_CAP) notes.push(m);
            }
            visits.push({
                plant_id: pid,
                name: (names && names[pid]) || null,
                first_ts: events[0].ts,
                last_ts: events[events.length - 1].ts,
                actions,
                action_counts,
                count: events.filter(e => e.click !== false).length || events.length,
                all_logs_notes: notes,
                _events: events,
            });
        }
        return visits.sort((a, b) => a.first_ts - b.first_ts);
    }

    // Notes lines for one timesheet entry.
    function formatAllLogsNotes(notes) {
        if (!notes || !notes.length) return '';
        return notes.slice(0, ALL_LOGS_NOTE_CAP).join('\n');
    }

    // Union two event lists for the SAME plant (All logs rows + pang history). Events carry no
    // plant_id, so the caller must only merge lists belonging to one plant.
    function mergeVisitEventLists(a, b) {
        const out = [];
        const seen = new Set();
        for (const e of [...(a || []), ...(b || [])]) {
            if (!e || !isFinite(e.ts)) continue;
            const k = e.ts + '|' + (e.action || '');
            if (seen.has(k)) continue;
            seen.add(k);
            out.push(e);
        }
        return out.sort((x, y) => x.ts - y.ts);
    }

    return {
        ALL_LOGS_SECRET_RE, ALL_LOGS_NOTE_CAP,
        rlRecapNormalizeUser, isPang1LogSystem, allLogsChipCode, allLogsDateWindow,
        maskAllLogsComment, filterAllLogsRecords, visitsFromAllLogsRecords,
        formatAllLogsNotes, mergeVisitEventLists,
    };
})();
// ===== Timesheet note prose ==========================================================
// The Notes field of a booked entry is what answers "what did I actually do on this task that day?"
// months later — and Rocketlane's drawer shows only its FIRST line, the rest behind a click. Before
// v4.111 the note led with a field dump ("Drawing changed: Oversikt_Øst: rev 4 → 5 · layout edited"),
// so the visible part was a label rather than an answer. These helpers turn the same facts into a
// summary sentence; the precise diff still follows underneath as evidence.
// Pure and dependency-free, outside the IIFE, so the unit tests can require them.
var RL_RECAP_NOTE_TEXT = (function () {
    'use strict';

    // "a" · "a and b" · "a, b and c" · "a, b, c and 4 more" — the readable form of a list.
    function bookAndList(items, max) {
        const arr = (items || []).filter(Boolean).map(String);
        if (!arr.length) return '';
        if (arr.length > max) return arr.slice(0, max).join(', ') + ` and ${arr.length - max} more`;
        if (arr.length === 1) return arr[0];
        return arr.slice(0, -1).join(', ') + ' and ' + arr[arr.length - 1];
    }

    // Join verb clauses into one capitalised, full-stopped sentence.
    function bookSentence(clauses) {
        const c = (clauses || []).filter(Boolean).map(String);
        if (!c.length) return '';
        const joined = c.length === 1 ? c[0] : c.slice(0, -1).join(', ') + ' and ' + c[c.length - 1];
        const s = joined.charAt(0).toUpperCase() + joined.slice(1);
        return /[.!?]$/.test(s) ? s : s + '.';
    }

    const bookPlural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

    // Unit labels carry their bus address ("AK-CC55-017x 6 (000:006)"). That belongs in the detail
    // lines, not in a summary sentence that would then nest parentheses inside parentheses.
    const bookBareLabel = s => String(s || '').replace(/\s*\([^()]*\)\s*$/, '').trim();

    // The day's config work as one sentence, from what bookTexts measured out of the commit diffs.
    function summarizeIntegration(f) {
        f = f || {};
        const devAdd = f.devAdd || [], settNames = f.settNames || [];
        const clauses = [];
        if (f.uAdd) clauses.push(`added ${bookPlural(f.uAdd, 'unit')}` + ((f.uAddNames || []).length ? ` (${bookAndList(f.uAddNames.map(bookBareLabel), 3)})` : ''));
        else if (devAdd.length) clauses.push('added ' + bookAndList([...new Set(devAdd)], 3));
        if (f.uRen) clauses.push(`renamed ${bookPlural(f.uRen, 'unit')}` + ((f.renPairs || []).length ? ` (${bookAndList(f.renPairs.slice(0, 2), 2)})` : ''));
        if (f.uDel) clauses.push(`removed ${bookPlural(f.uDel, 'unit')}`);
        const tuned = (f.devMod || []).filter(x => devAdd.indexOf(x) < 0);
        if (tuned.length) clauses.push('tuned parameters on ' + bookAndList(tuned, 3));
        if (f.virtVals) clauses.push('updated the virtual values');
        if (settNames.length) clauses.push(`changed ${bookPlural(settNames.length, 'plant setting')} (${bookAndList(settNames.slice(0, 2), 2)})`);
        return bookSentence(clauses);
    }

    // Drawing work as one sentence. A single panel is named with what changed inside it; several are
    // listed by name, because "which drawings did I touch" is the thing worth recalling.
    function summarizeDrawing(panelInfo, drawingNames, designerSession) {
        const p = panelInfo || [], names = drawingNames || [];
        if (p.length === 1) {
            const one = p[0];
            const detail = [(one.what || []).length ? one.what.join(' and ') + ' edited' : '',
                one.from != null ? `rev ${one.from} → ${one.to}` : ''].filter(Boolean).join(', ');
            return bookSentence([`${one.added ? 'created' : 'updated'} the "${one.panel}" drawing in the Designer`
                + (detail ? ` (${detail})` : '')]);
        }
        if (p.length) {
            const nNew = p.filter(x => x.added).length;
            return bookSentence([`worked on ${bookPlural(p.length, 'drawing')} in the Designer — `
                + bookAndList(p.map(x => `"${x.panel}"`), 4) + (nNew ? ` (${bookPlural(nNew, 'new one')})` : '')]);
        }
        if (names.length) {
            return bookSentence([`changed ${bookPlural(names.length, 'drawing')} in the Designer — `
                + bookAndList(names.map(n => `"${n}"`), 4)]);
        }
        return designerSession ? 'Worked in the Designer on the plant\'s drawings.' : '';
    }

    // Fallback when the day left no config commit: describe the session by the tools it used.
    // `tools` is [{label, count}], already ordered by the caller.
    function summarizeActions(tools) {
        const t = (tools || []).filter(x => x && x.label);
        if (!t.length) return '';
        return bookSentence(['worked on the plant via '
            + bookAndList(t.slice(0, 4).map(x => x.label + (x.count > 1 ? ` (×${x.count})` : '')), 4)]);
    }

    // The finished Notes field, in two blocks for two readers (v4.131, Thomas: "so my boss can easily
    // read it … under the note should also be technical of what you actually did"):
    //
    //   <plain-language line — what happened to the plant, for the project leader>
    //   Site note: <what you wrote in the operations log that day, your own words>
    //
    //   Technical: <the engineer's sentence>
    //   <the diff lines, as evidence>
    //
    // Rocketlane shows only the first line collapsed, so the leader's line is the first line. The site
    // note sits in the same block because it is the most human description there is; it used to be
    // labelled "Log:" and parked under the summary, which read as machinery. The technical block is
    // labelled so the split is unmistakable when the note is expanded or rendered into a task's
    // Description.
    function composeEntryNote(summary, logNotes, details, tech) {
        const site = (logNotes || []).filter(Boolean).map(l => 'Site note: ' + l).join('\n');
        const top = [summary, site].filter(Boolean).join('\n');
        const bottom = [tech ? 'Technical: ' + tech : '', details].filter(Boolean).join('\n');
        return [top, bottom].filter(Boolean).join('\n\n');
    }

    // ---- Leader-facing opening line (v4.114, rewritten v4.131) ---------------------------------
    // The first line of a booked note is the only one Rocketlane shows collapsed, and the person
    // reading it is the project leader, not the engineer. v4.114 phrased it in service terms but
    // dropped the one thing a non-technical reader recognises — the equipment's own names ("Kjøttdisk
    // 3", "Fryserom") — and asserted "control and alarm settings" for every tuned device, including a
    // Data Engine poll rate. v4.131 names the equipment, frames the day (commissioning / service /
    // follow-up), says what the change means, and only claims alarm limits when a parameter label
    // actually says so. `discs` = the day's detected disciplines, best first.
    const LEAD_NOUN = {
        refrig: 'refrigeration controller', vent: 'ventilation controller', energy: 'energy meter',
        wireless: 'wireless sensor', heat: 'heating controller', machine: 'machine-room controller',
    };
    const LEAD_SYSTEM = {
        refrig: 'refrigeration', vent: 'ventilation', energy: 'energy', wireless: 'wireless-sensor',
        heat: 'heating', machine: 'machine-room',
    };
    const LEAD_REPORTS = {
        refrig: 'temperatures and alarms', vent: 'temperatures, airflow and alarms', energy: 'consumption readings',
        wireless: 'readings', heat: 'temperatures and alarms', machine: 'status and alarms',
    };
    // The tools of a session, in words a leader reads without a glossary.
    const LEAD_TOOL = {
        'phpMyAdmin': 'database work', 'VNC': 'a remote-desktop session on the site server',
        'topology': 'a review of the system layout', 'direct login': 'logging in to the plant',
        'status check': 'a status check', 'restarts': 'restarting plant services', 'backup': 'a backup',
        'AK3': 'scanner setup', 'client admin': 'client administration', 'file upload': 'a file upload',
        'Designer': 'work in the drawing tool', 'alarm settings': 'alarm-setting changes',
        'duty list': 'a duty-list update', 'service logon': 'a service logon', 'note': 'a handover note',
        'alarm call': 'an alarm call',
    };
    const leadTools = (tools, max) => (tools || []).filter(x => x && x.label).slice(0, max).map(x => LEAD_TOOL[x.label] || String(x.label));

    // What a set of changed parameter labels amounts to, in plain words — and ONLY what they amount to.
    // Labels are snake_case column names ("sp_temp", "alarm_high"); `_` is a word character to ``, so
    // separators are normalised to spaces first or "sp_temp" would never read as a setpoint.
    function leadTuneKinds(labels) {
        const t = (labels || []).map(x => String(x).toLowerCase().replace(/[_\-.]+/g, ' '));
        const kinds = [];
        if (t.some(x => /alarm|\balm\b|delay|limit|grense|\bhigh\b|\blow\b|\bhi\b|\blo\b/.test(x))) kinds.push('alarm limits');
        if (t.some(x => /setpoint|set_?p\b|\bsp\b|settpunkt|\btemp/.test(x))) kinds.push('setpoints');
        if (t.some(x => /poll|interval|\blog|address|\badr|baud|\bport|timeout/.test(x))) kinds.push('communication settings');
        return kinds.length ? bookAndList(kinds, 3) : 'settings';
    }

    function summarizeLeadIntegration(f, discs) {
        f = f || {};
        const d = (discs || [])[0];
        const noun = LEAD_NOUN[d] || 'device', sys = LEAD_SYSTEM[d] ? LEAD_SYSTEM[d] + ' ' : '';
        const clauses = [];
        const nAdd = f.uAdd || (f.devAdd || []).length;
        if (nAdd) {
            const names = (f.uAddNames || []).map(bookBareLabel).filter(Boolean);
            clauses.push(`connected ${bookPlural(nAdd, 'new ' + noun)}` + (names.length ? ` (${bookAndList(names, 3)})` : '') + ' to the monitoring platform');
        }
        const tuned = (f.devMod || []).filter(x => (f.devAdd || []).indexOf(x) < 0);
        if (tuned.length) clauses.push(`fine-tuned ${leadTuneKinds(f.tuneLabels)} on ${bookPlural(tuned.length, 'device')}`);
        if (f.uRen) clauses.push(`gave ${bookPlural(f.uRen, 'device')} clearer names` + ((f.renPairs || []).length ? ` (${bookAndList(f.renPairs.slice(0, 2), 2)})` : ''));
        if (f.uDel) clauses.push(`removed ${bookPlural(f.uDel, 'device')} from monitoring`);
        if ((f.settNames || []).length) clauses.push('adjusted plant-level settings');
        if (f.virtVals) clauses.push("updated the plant's calculated values");
        if (!clauses.length) return '';
        const frame = nAdd ? `Commissioning work on the plant's ${sys}monitoring`
            : tuned.length ? `Service work on the plant's ${sys}monitoring`
            : `Work on the plant's ${sys}monitoring setup`;
        const outcome = nAdd ? ` ${nAdd === 1 ? 'It now reports' : 'They now report'} ${LEAD_REPORTS[d] || 'status'} to the platform.` : '';
        return bookSentence([frame + ' — ' + bookAndList(clauses, 6)]) + outcome;
    }

    function summarizeLeadDrawing(panelInfo, drawingNames, discs) {
        const p = panelInfo || [];
        const n = p.length || (drawingNames || []).length;
        if (!n) return '';
        const names = (p.length ? p.map(x => x.panel) : drawingNames).map(bookBareLabel).filter(Boolean);
        const created = p.filter(x => x.added).length;
        const sys = LEAD_SYSTEM[(discs || [])[0]];
        const what = `${sys ? sys + ' ' : ''}overview screen${n === 1 ? '' : 's'}`;
        const verb = created && created === n ? (n === 1 ? 'Built a new' : `Built ${n} new`) : (n === 1 ? 'Updated the' : `Updated ${n}`);
        const list = names.length ? ` (${bookAndList(names.map(x => `"${x}"`), 3)})` : '';
        return `${verb} ${what}${list} — the display the plant's operators use to see live status and alarms.`;
    }

    function summarizeLeadSetup(rac) {
        return rac
            ? 'Configured the plant\'s communication gateway (RAC) so the plant reports to the monitoring platform.'
            : 'Set up the plant\'s AK3 gateway/scanner so its devices report to the monitoring platform.';
    }

    // A session that left no describable configuration change: say what was done in plain words, and
    // say honestly whether anything was saved. `saved` is true when config commits existed but carried
    // nothing worth reporting (noise tables only), false when the day left no commit at all.
    function summarizeLeadActions(tools, saved) {
        const t = leadTools(tools, 4);
        if (!t.length) return '';
        return `Remote maintenance on the plant's monitoring system — ${bookAndList(t, 4)}; ` +
            (saved ? 'only minor configuration changes were saved.' : 'no configuration changes were saved.');
    }

    function summarizeLeadSupport(tools) {
        const t = leadTools(tools, 3);
        return 'Follow-up on the plant from the office — ' + (t.length ? bookAndList(t, 3) : 'checked its status and logs') + '; no configuration was changed.';
    }

    return {
        bookAndList, bookSentence, bookPlural, bookBareLabel,
        summarizeIntegration, summarizeDrawing, summarizeActions, composeEntryNote,
        summarizeLeadIntegration, summarizeLeadDrawing, summarizeLeadSetup, summarizeLeadSupport,
        summarizeLeadActions, leadTuneKinds,
    };
})();
// ===== Transition-based time evidence ================================================
// The estimator's cross-plant timeline already credits each plant from your first action on it until
// the moment you move to the next one — but a raw click gap is capped at 30 min, and a silent
// sub-tool session (Designer, phpMyAdmin, VNC) leaves only one trace of when you actually left: the
// plant's own change-triggered config commit. These helpers re-judge each capped silence — and the
// day's final wrap-up — against those commits, so the plant-to-plant transitions come from evidence
// instead of a flat cap. Pure and dependency-free, outside the IIFE, so time-model.test.js can
// require them directly.
var RL_RECAP_TIME = (function () {
    'use strict';

    // Credit for ONE capped gap on one plant. `gapMs` is the real silence following the click at the
    // gap's start; `commitOffsetsMs` are the plant's change-triggered commits as offsets from that
    // start. Only offsets inside (0, min(gapMs, evidenceMs)] count — the same 60-min trust horizon
    // the v4.56 damping used, because a commit is authorless and the further it sits from your last
    // click the weaker the claim that it was your save. Returns minutes:
    //  - a commit inside the horizon proves presence up to it → credit the span (last such commit
    //    plus a short wrap-up), never below the old 30-min cap (lift-only, so every previously
    //    approved day keeps at least its old value) and never beyond the real gap;
    //  - no commit and the silence is long (> longGapMs) → the damped credit (a long unevidenced
    //    silence is far more likely a break or a meeting);
    //  - no commit, ordinary capped gap → the cap, exactly as before.
    function cappedGapCredit(gapMs, commitOffsetsMs, C) {
        const horizon = Math.min(gapMs, C.evidenceMs);
        const inside = (commitOffsetsMs || []).filter(o => o > 0 && o <= horizon);
        if (inside.length) {
            const span = Math.round(Math.max.apply(null, inside) / 60000) + C.wrapMin;
            return Math.max(C.capMin, Math.min(span, Math.round(gapMs / 60000)));
        }
        if (gapMs > C.longGapMs) return C.dampMin;
        return C.capMin;
    }

    // The day's very LAST action gets a flat tail wrap-up (10 min) — but when the plant's own
    // change-triggered commit lands shortly after it, the save timestamps the real end of the day.
    // Returns the EXTRA minutes to add on top of the tail already credited (0 when no commit within
    // `maxAfterMs`, or when the flat tail already covers the span). Lift-only, bounded by the same
    // 20-min window the commit-fusion rules use.
    function dayEndExtension(lastTs, commitTimes, C) {
        const after = (commitTimes || []).filter(t => t > lastTs && t <= lastTs + C.maxAfterMs);
        if (!after.length) return 0;
        const extra = Math.round((Math.max.apply(null, after) - lastTs) / 60000) + C.wrapMin - C.tailMin;
        return Math.max(0, extra);
    }

    // Largest-remainder allocation: integer, nonnegative and exactly budget-conserving.
    // Full rounding units are apportioned first; an off-grid remainder stays real minutes.
    // No minimum per plant: a tiny remaining budget cannot buy five minutes for every plant.
    function allocateMinutes(weights, targetMinutes, roundTo = 1) {
        const target = Number.isFinite(targetMinutes) ? Math.max(0, Math.round(targetMinutes)) : 0;
        const step = Number.isFinite(roundTo) ? Math.max(1, Math.floor(roundTo)) : 1;
        if (!weights.length) return [];
        let clean = weights.map(w => Number.isFinite(w) && w > 0 ? w : 0);
        let sum = clean.reduce((a, b) => a + b, 0);
        if (!sum) { clean = clean.map(() => 1); sum = clean.length; }
        const units = Math.floor(target / step);
        const shares = clean.map(w => w / sum * units);
        const allocated = shares.map(q => Math.floor(q) * step);
        const order = shares.map((q, i) => ({ i, fraction: q - Math.floor(q) }))
            .sort((a, b) => b.fraction - a.fraction || clean[b.i] - clean[a.i] || a.i - b.i);
        const left = units - allocated.reduce((a, b) => a + b, 0) / step;
        for (let j = 0; j < left; j++) allocated[order[j].i] += step;
        const remainder = target % step;
        if (remainder) {
            let best = 0;
            for (let i = 1; i < clean.length; i++) {
                if (clean[i] / sum * target - allocated[i] > clean[best] / sum * target - allocated[best]) best = i;
            }
            allocated[best] += remainder;
        }
        return allocated;
    }

    // The day's minute budget (v4.130, Thomas's rule: "the goal is to fill out 7.5 everyday … make sure
    // you don't exceed that amount"). The target is what the weekday TOTALS, not what this script adds,
    // so everything already on the timesheet for that date counts against it — including hours typed in
    // by hand, which nothing here had ever looked at. Measured on the live sheet before this was written:
    // 02.09 read 7,83 h and 04.09 7,92 h, because the plant distribution filled a whole 7,5 h on top of
    // manual entries; other days sat at 5,83 h and 6,92 h.
    //
    // Order is deliberate. What is already booked is a fact and cannot be rescaled. Calendar time is
    // real and priced first (v4.117). Plant estimates are the only soft number, so they absorb whatever
    // is left — which is also why they are the only thing that can be squeezed to zero.
    function dayBudget(o) {
        o = o || {};
        const num = v => (Number.isFinite(v) && v > 0 ? Math.round(v) : 0);
        const workday = num(o.workdayMin);
        const existing = num(o.existingMin);   // already on the sheet for this date, whoever put it there
        const calendar = num(o.calendarMin);   // Outlook rows about to be booked (⏭ ones are in `existing`)
        const committed = existing + calendar;
        const plantMin = Math.max(0, workday - committed);
        return {
            workday, existing, calendar, committed, plantMin,
            total: committed + plantMin,        // what the day reads once this booking lands
            full: plantMin === 0 && committed > 0, // no room left for plant work
            over: committed > workday,
            overBy: Math.max(0, committed - workday),
            under: Math.max(0, workday - (committed + plantMin)), // only non-zero if workday is 0
        };
    }

    return { cappedGapCredit, dayEndExtension, allocateMinutes, dayBudget };
})();
// ===== Outlook calendar → meeting / admin time =======================================
// pang only sees plant work, so meetings, planning and training never reached the timesheet — and
// because the day is distributed to a 7,5 h total, that time was silently absorbed into the plant
// estimates. These helpers turn one day of Outlook calendar events into bookable entries. Pure and
// dependency-free (the fetching half lives in the IIFE), so calendar.test.js can require them.
//
// PRIVACY: an event's subject is the user's own text and can name customers or staff. It is used as
// the entry's activity title (that is the point) but is never logged, never sent anywhere except
// Rocketlane, and `calMaskSubject` strips anything that looks like a credential — the same rule the
// IWMAC handover notes follow.
var RL_RECAP_CAL = (function () {
    'use strict';

    const CAL_SECRET_RE = /pass|pwd|secret|token|key|\bpw\b/i;
    const CAL_TITLE_MAX = 90;

    function calMaskSubject(s) {
        s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
        if (!s) return '';
        if (CAL_SECRET_RE.test(s)) return '[redacted]';
        return s.length > CAL_TITLE_MAX ? s.slice(0, CAL_TITLE_MAX - 1) + '…' : s;
    }

    // Category routing. Norwegian and English keywords, word-start matched (compounds: "kundemøte",
    // "planleggingsmøte"). First rule that hits wins, so the list is ordered most-specific first.
    // The module deliberately does NOT know Rocketlane's category IDs — it returns a KIND, and the
    // IIFE maps kind → the tenant's category name, exactly like the task matcher does.
    const CAL_RULES = [
        ['training', /kurs|opplær|training|workshop|sertifiser|certification|webinar/i],
        ['planning', /planlegg|planning|prioriter|sprint|backlog|ukeplan|månedsplan|status(?:møte)?|oppfølging/i],
        ['external', /kunde|customer|client|befaring|leverandør|supplier|partner|ekstern|external|entrepren|byggemøte|site meeting/i],
        ['internal', /./], // default: an internal meeting
    ];
    function calKindOf(subject) {
        const s = String(subject || '');
        for (const [kind, re] of CAL_RULES) if (re.test(s)) return kind;
        return 'internal';
    }

    // One Outlook REST event → the shape the panel books from. `Start`/`End` arrive as
    // {DateTime, TimeZone}; with the Prefer: outlook.timezone header they are already local wall
    // clock, which is what the timesheet wants — so parse them as local, never as UTC.
    function calParseLocal(dt) {
        const s = String((dt && dt.DateTime) || dt || '');
        const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
        if (!m) return NaN;
        return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
    }
    function calNormalizeEvent(rec) {
        if (!rec) return null;
        const startTs = calParseLocal(rec.Start), endTs = calParseLocal(rec.End);
        if (!isFinite(startTs) || !isFinite(endTs)) return null;
        return {
            id: String(rec.Id || rec.iCalUId || (startTs + '|' + (rec.Subject || ''))),
            subject: calMaskSubject(rec.Subject),
            startTs, endTs,
            allDay: !!rec.IsAllDay,
            cancelled: !!rec.IsCancelled,
            free: String(rec.ShowAs || '') === 'Free',
            declined: String((rec.ResponseStatus && rec.ResponseStatus.Response) || '') === 'Declined',
            organizer: !!rec.IsOrganizer,
            recurring: String(rec.Type || '') === 'Occurrence',
            kind: calKindOf(rec.Subject),
        };
    }

    // What never becomes a timesheet entry, whatever the user's filter settings: a cancelled event
    // (it did not happen), one he declined (he was not there), and one marked Free (a placeholder or
    // a reminder, not time worked). Tentative / not-responded events ARE kept — Thomas's call: he
    // attends plenty of meetings without clicking Accept.
    function calIsBookable(ev) {
        return !!ev && !ev.cancelled && !ev.declined && !ev.free && ev.endTs > ev.startTs;
    }

    // Wall-clock minutes the day's meetings actually occupy, overlaps counted once: two events
    // 10:00–11:00 and 10:30–11:30 span 90 minutes, not 120. No longer used for PRICING a row (v4.123
    // books every meeting at its real length) — kept as an exported helper for tests and for reasoning
    // about a double-booked day. All-day events are excluded (they carry the whole day, priced apart).
    function calMergedMinutes(events) {
        const spans = (events || []).filter(e => e && !e.allDay).map(e => [e.startTs, e.endTs])
            .sort((a, b) => a[0] - b[0]);
        let total = 0, curS = null, curE = null;
        for (const [s, e] of spans) {
            if (curS === null) { curS = s; curE = e; continue; }
            if (s <= curE) { if (e > curE) curE = e; continue; }
            total += curE - curS; curS = s; curE = e;
        }
        if (curS !== null) total += curE - curS;
        return Math.round(total / 60000);
    }

    // A meeting books EXACTLY as long as it stands in Outlook — always (v4.123, Thomas's rule). Earlier
    // versions scaled the day's rows down to the merged wall-clock span and rounded them to the 5-minute
    // grid, so a 60-minute meeting overlapping another booked as 45, and an odd-length one drifted off
    // its real time. Being double-booked does not shorten the meeting you sat in, and a timesheet row
    // that disagrees with the invite is simply wrong. Consequence, by design: on a double-booked day the
    // meetings can sum past the wall clock, and since "meetings first" subtracts that sum, plant work
    // gets the smaller remainder. `roundTo` is accepted for signature stability but deliberately unused.
    // An all-day event is still priced at the whole workday — it has no clock duration, and a full-day
    // course IS the day, which correctly leaves nothing for plant work.
    function calAllocate(events, workdayMin, roundTo) {
        const ok = (events || []).filter(calIsBookable);
        const allDay = ok.filter(e => e.allDay), timed = ok.filter(e => !e.allDay);
        const out = [];
        for (const e of allDay) out.push({ ev: e, minutes: workdayMin });
        if (allDay.length) return out; // the day is already fully accounted for
        for (const e of timed) out.push({ ev: e, minutes: Math.max(1, Math.round((e.endTs - e.startTs) / 60000)) });
        return out;
    }

    // How much of the workday is left for plant work once the meetings are booked (v4.117: Thomas's
    // rule — meetings first, plant work fills the rest). Never negative, never more than the workday.
    function calRemainingWorkday(allocations, workdayMin) {
        const used = (allocations || []).reduce((s, a) => s + (a && a.minutes || 0), 0);
        return Math.max(0, Math.min(workdayMin, workdayMin - used));
    }

    // The entry's Notes field: same contract as a plant entry — a plain first line a project leader
    // can read, then the facts underneath.
    function calEntryNote(ev, mins) {
        if (!ev) return '';
        const when = ev.allDay ? 'All day' : `${calClock(ev.startTs)}–${calClock(ev.endTs)}`;
        // Say the whole story on the note: when it ran, from when till when, and how long that is
        // (v4.124). The booked minutes were the one fact the note never stated.
        const dur = calDuration(mins);
        const lead = ev.allDay
            ? `Full-day calendar commitment: ${ev.subject}.`
            : `Attended "${ev.subject}" ${when}${dur ? ` (${dur})` : ''}.`;
        const facts = [`Calendar: ${when}`, dur, ev.recurring ? 'Recurring event' : '', ev.organizer ? 'Organiser' : '']
            .filter(Boolean).join(' · ');
        return [lead, facts].filter(Boolean).join('\n\n');
    }
    function calDuration(mins) {
        const m = Math.max(0, Math.round(mins || 0));
        if (!m) return '';
        const h = Math.floor(m / 60), r = m % 60;
        return h ? (r ? `${h} h ${r} min` : `${h} h`) : `${r} min`;
    }
    function calClock(ts) {
        const d = new Date(ts);
        return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    }

    // Which questions Book week's pre-build check-up must ask (v4.129). Pure so the once-a-day rule is
    // testable — the rest of the check-up is markup, but this is the part that can be wrong in ways
    // nobody notices: asking every single build (nagging) or never asking again (the bug it fixes).
    //   fullScanRanToday  a full plant scan already ran today
    //   scanChoice        the scan answer for THIS modal, null while pending
    //   calChoice         the calendar answer for THIS modal, null while pending
    //   calAskedDate      'YYYY-MM-DD' the calendar question was last asked on ('' = never)
    //   today             'YYYY-MM-DD'
    // Why the calendar could not be read, as a stable code plus a sentence (v4.132, Thomas: "if you
    // are not logged in to outlook give out warning and to login"). Signed-out is the failure that
    // matters: the sync tab is redirected to the Microsoft login page, where this script never runs,
    // so the only symptom used to be "Outlook did not answer in time" — which reads as slowness.
    //   no-token  the Outlook tab loaded but its MSAL cache holds no calendar token ⇒ signed out
    //   http      the REST call was refused; 401/403 ⇒ session expired, anything else ⇒ a read error
    //   timeout   a tab was opened and never answered ⇒ almost always the login redirect
    //   no-answer the tab answered with no result   open  no tab could be opened   exception  threw
    function calErrorFor(kind, status) {
        switch (kind) {
            case 'no-token': return { code: 'signin', error: 'not signed in to Outlook' };
            case 'http': return (status === 401 || status === 403)
                ? { code: 'signin', error: 'Outlook session expired (HTTP ' + status + ')' }
                : { code: 'read', error: 'Outlook returned HTTP ' + status };
            case 'timeout': return { code: 'signin-likely', error: 'Outlook did not answer — most likely you are not signed in' };
            case 'no-answer': return { code: 'read', error: 'Outlook answered with nothing' };
            case 'open': return { code: 'open', error: 'could not open Outlook' };
            case 'exception': return { code: 'read', error: 'calendar read failed' };
            default: return { code: 'read', error: 'calendar unavailable' };
        }
    }
    const calNeedsSignin = code => code === 'signin' || code === 'signin-likely';

    function weekCheckupPlan(s) {
        s = s || {};
        return {
            askScan: !s.fullScanRanToday && s.scanChoice == null,
            askCal: s.calChoice == null && String(s.calAskedDate || '') !== String(s.today || ''),
        };
    }

    return {
        CAL_SECRET_RE, CAL_RULES,
        calMaskSubject, calKindOf, calParseLocal, calNormalizeEvent, calIsBookable,
        calMergedMinutes, calAllocate, calRemainingWorkday, calEntryNote, calClock, calDuration,
        weekCheckupPlan, calErrorFor, calNeedsSignin,
    };
})();
// ===== Rocketlane task matcher =======================================================
// Which EXISTING project task a day's work should be booked onto. Pure and outside the IIFE for the
// same reason as the blocks above: this is the most heuristic code in the script, so it has to be
// measurable. `task-match.test.js` pins it against real project task lists.
var RL_RECAP_MATCH = (function () {
    'use strict';

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
    //
    // `prose` (v4.112) requires each keyword to start a WORD. The keyword lists were written for
    // machine-generated token strings, where a bare substring test is fine; free Norwegian text is a
    // different matter. The wireless list carries `'ing '` (the ING sensor prefix), which as a plain
    // substring also matches montering, bestilling, endring, innstilling, løsning — i.e. most sentences
    // Thomas writes in the operations log, every one of which would have scored as wireless work.
    //
    // Leading boundary only, deliberately: Norwegian compounds concatenate, so a discipline word shows up
    // at the START of a word and runs into the rest of it — kjøledisk, kjølemaskin, energimåler,
    // ventilasjonsanlegg, maskinrom. Requiring a trailing boundary too would miss every one of those.
    // It also drops two substring accidents for free: "parameter" no longer scores energy via 'meter'.
    // Token strings keep the original substring test, so the 4.82 calibration is untouched.
    const _bdwRe = {};
    function bookDiscWeights(str, prose) {
        const w = {}; const t = String(str || '').toLowerCase();
        for (const d of TASK_DISCIPLINES) {
            let n = 0;
            for (const k of d[2]) {
                if (prose) {
                    let re = _bdwRe[k];
                    if (!re) re = _bdwRe[k] = new RegExp('(^|[^a-z0-9æøå])' + k.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
                    if (re.test(t)) n++;
                } else if (t.includes(k)) n++;
            }
            if (d[1].test(bookNorm(t))) n++;
            if (n) w[d[0]] = n;
        }
        return w;
    }
    // Words that name a work package's KIND rather than the work itself — they appear in half the
    // task list, so a hit on one says nothing about WHICH task today's text describes.
    const BOOK_NAME_GENERIC = new Set([
        'design', 'integration', 'integrasjon', 'setup', 'oppsett', 'project', 'prosjekt',
        'plant', 'anlegg', 'system', 'task', 'oppgave', 'arbeid', 'work', 'image', 'new',
        'nye', 'nytt', 'den', 'det', 'har', 'ble', 'ikke', 'til', 'med', 'for', 'the', 'and', 'og',
        'configured', 'configuration', 'konfigurert', 'konfigurering', 'completed', 'done',
    ]);
    const _bnhRe = {};
    // How many DISTINCTIVE words of a task's name appear in the day's evidence text (v4.114). Word-
    // START match, same rationale as prose-mode bookDiscWeights: Norwegian compounds concatenate, so
    // "kjøl" must still find "kjøledisken". Used as a TIEBREAK between candidates the discipline
    // evidence scored identically — a day whose note says "byttet føler i kjøl rack 2" should land on
    // "Integration: Kjøl", not on whichever tied task the history habit prefers.
    function bookNameHits(taskName, blob) {
        if (!blob) return 0;
        const words = bookNorm(String(taskName || '').replace(/^[a-zæøå ]+\s*[:\-]/i, '')).split(' ')
            .filter(w => w.length >= 3 && !BOOK_NAME_GENERIC.has(w));
        let n = 0;
        for (const w of [...new Set(words)]) {
            let re = _bnhRe[w];
            if (!re) re = _bnhRe[w] = new RegExp('(^|[^a-z0-9æøå])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
            if (re.test(blob)) n++;
        }
        return n;
    }
    // `prior` is the task-id order this project+category is usually booked onto, best first (v4.113).
    // It only ever breaks a tie the evidence could not — see rlTaskPrior for the measurement.
    const PRIOR_UNRANKED = 1e9; // finite on purpose: Infinity - Infinity is NaN, which poisons a comparator
    function bookPriorRank(prior, t) {
        if (!prior || !prior.length) return PRIOR_UNRANKED;
        const i = prior.indexOf(String(t.taskId));
        return i < 0 ? PRIOR_UNRANKED : i;
    }
    function bookPickWeighted(cands, weights, stripRe, guess, prior, nameBlob) {
        if (!cands.length) return null;
        // Tiebreaks, in order (lexicographic — top candidate must beat #2 somewhere or it's ambiguous):
        //  1. evidence score
        //  2. specificity (v4.89, from the canonical template): "Heating/ VGV" spans TWO disciplines
        //     (heat + vent via "VGV") and used to tie plain "Ventilation" — FEWER named disciplines wins.
        //  3. name over phase (v4.90): a task whose NAME carries the discipline beats one that only
        //     inherits it from its phase/category ("Design: Refrigeration" > "Nytt oversiktsbilde").
        //  4. name-in-text (v4.114): the day's own text mentions one tied task's distinctive name
        //     words — today's evidence, so it outranks the habit prior below.
        //  5. the booking-history prior (v4.113) — LAST among the tiebreaks, so it can only order
        //     candidates the evidence scored identically. An evidence tie used to mean "ambiguous, fall
        //     through", which ended at an alphabetical guess; now the task this project+category is
        //     actually booked onto wins it (measured 76% correct — see rlTaskPrior).
        // With `guess` (v4.92, rescue mode): a full tie no longer gives up — the alphabetically first of
        // the tied-top tasks is returned as the best guess (existing task beats a new activity).
        const scored = cands.map(t => {
            let td = bookDiscOf(t.taskName.replace(stripRe, '')), ph = 0;
            if (!td.size && t.phase) { td = bookDiscOf(t.phase); ph = 1; } // "Nytt oversiktsbilde" under phase "Refrigeration and freezing systems"
            let ov = 0; for (const x of td) ov += (weights[x] || 0);
            return { t, ov, nd: td.size, ph, nm: bookNameHits(t.taskName, nameBlob) };
        }).filter(x => x.ov > 0);
        if (scored.length === 1) return scored[0].t;
        if (scored.length > 1) {
            const pr = t => bookPriorRank(prior, t);
            scored.sort((a, b) => (b.ov - a.ov) || (a.nd - b.nd) || (a.ph - b.ph)
                || (b.nm - a.nm) || (pr(a.t) - pr(b.t)) || a.t.taskName.localeCompare(b.t.taskName));
            const [a, b] = scored;
            if (guess || a.ov !== b.ov || a.nd !== b.nd || a.ph !== b.ph) return a.t;
            // Evidence is fully tied. The day's own text naming one of the tied tasks decides first
            // (v4.114); after that the history prior; only a full tie falls through to a rescue guess.
            if (a.nm !== b.nm) return a.t;
            if (pr(a.t) !== pr(b.t)) return a.t;
        }
        return null; // ambiguous ⇒ let the fallback decide
    }
    // Sales-order quantity lines ("Per energy meter — 3 pcs", "IWMAC Aftermarket: … price per unit — 26 pcs",
    // "IWMAC Image: System image - Machinery — x3") are price rows, not work packages — they contain
    // discipline words and would pollute the scoring. Covers the "N pcs", "xN"/"N stk" and IWMAC
    // Image/Aftermarket sales-line notations (seen live on 2701, v4.95).
    const BOOK_QTY_TASK_RE = /\b\d+\s*(pcs|stk)\b|price per unit|aftermarket|^iwmac\s+(image|aftermarket|hw|hardware|licen[cs]e)\b|[—–-]\s*x\s?\d+\s*$/i;
    // Checklist/admin rows are never time-booking targets, not even in rescue mode ("Customers approval",
    // "Alarm test", "Close sales order", "Documentation approved", "Project Satisfaction Survey", …).
    const BOOK_CHECKLIST_RE = /approv|godkjen|survey|dokumentasjon|documentation|subscription|abonnement|\border\b|ordre|handover|overlever|quality|kvalitet|\bsales\b|salg|faktur|invoice|received|alarm test|milestone|møte|meeting/i;
    // Which Rocketlane project a plant belongs to, by the number in the project's name (v4.133,
    // Thomas: "if they match same number its the right rocketlane project"). Measured on the live
    // tenant: 863 non-archived projects, of which 410 follow the "<n> - Name" convention, **171** are
    // "<n> Name" with no separator at all, 6 carry the number elsewhere ("10109 (8547) - Joker Blaker"),
    // 276 have no number. The old rule required the separator, so all 171 were invisible and their
    // plants went to the Team bucket. Tiers, strictest first — the first tier with any hit wins, so a
    // properly named "<n> - X" always beats a loose mention of the same number somewhere else:
    //   1  "<n> - X" / "<n>: X" / "<n>. X"        the naming convention
    //   2  "<n> X"                                 the convention minus its separator
    //   3  the number anywhere as a whole token    "10109 (8547) - Joker Blaker", "… -9466 Coop Jokkmokk"
    // The number must be the WHOLE token: 1023 never matches "10232 - …" and 10232 never "1023 - …".
    // Within a tier several projects can share the number ("11061 - Willys Östhammar" and "… - Fastighet"
    // — 12+ such pairs live). `lastBooked` (projectId → last date Thomas booked on it) picks the one
    // actually in use; with no history, list order, as before.
    // Twins (v4.134, Thomas: "3530 looks like you did not find project for this / maybe there is more
    // cases like this"). 13 numbers carry two live projects. Three of them are a real plan next to a
    // SHELL — a project Rocketlane seeded with its default tasks and nobody planned in: 3530 (2 tasks vs
    // 23), 2191 (2 vs 36), 9964 (34 vs 2). The 4.133 history tiebreak was actively wrong there: the old
    // list-first rule had booked 3530 onto the shell, and those bookings then "confirmed" the shell. So
    // among twins the order is now: a project the user PINNED for this number → the one with a real
    // plan when the other is a shell → the one last booked (only between projects that both look real)
    // → list order. Task counts and the pin are inputs, so this stays pure.
    const SHELL_TASKS_MAX = 3; // a seeded-but-unplanned Rocketlane project carries 2 default tasks
    function findProjectForPlant(list, plantId, lastBooked, opts) {
        const id = String(plantId == null ? '' : plantId).trim();
        const none = { project: null, tier: 0, candidates: [], reason: '' };
        if (!id) return none;
        const o = opts || {};
        const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const tiers = [
            new RegExp('^\\s*' + esc + '\\s*[-–—:.]'),
            new RegExp('^\\s*' + esc + '\\s+\\S'),
            new RegExp('(^|[^0-9])' + esc + '([^0-9]|$)'),
        ];
        const lastOf = p => {
            if (!lastBooked) return '';
            const v = typeof lastBooked.get === 'function' ? lastBooked.get(String(p.id)) : lastBooked[String(p.id)];
            return String(v || '');
        };
        const countOf = p => {
            const tc = o.taskCount; if (tc == null) return null;
            const v = typeof tc === 'function' ? tc(p) : (typeof tc.get === 'function' ? tc.get(String(p.id)) : tc[String(p.id)]);
            return (v != null && Number.isFinite(+v)) ? +v : null;
        };
        for (let t = 0; t < tiers.length; t++) {
            const cands = (list || []).filter(p => p && tiers[t].test(String(p.name || '')));
            if (!cands.length) continue;
            let pick = cands[0], reason = '';
            if (cands.length > 1) {
                reason = 'first';
                const pinned = o.pinned != null ? cands.find(p => String(p.id) === String(o.pinned)) : null;
                if (pinned) { pick = pinned; reason = 'pinned'; }
                else {
                    const counted = cands.map(p => ({ p, n: countOf(p) }));
                    const real = counted.filter(x => x.n != null && x.n > SHELL_TASKS_MAX);
                    const shells = counted.filter(x => x.n != null && x.n <= SHELL_TASKS_MAX);
                    if (real.length && shells.length && real.length + shells.length === cands.length) {
                        // a plan next to a shell: the plan, and history only to choose BETWEEN plans
                        pick = real.slice().sort((a, b) => lastOf(b.p).localeCompare(lastOf(a.p)))[0].p; reason = 'plan';
                    } else {
                        const byHist = cands.slice().sort((a, b) => lastOf(b).localeCompare(lastOf(a)));
                        if (lastOf(byHist[0])) { pick = byHist[0]; reason = 'history'; }
                    }
                }
            }
            return { project: pick, tier: t + 1, candidates: cands, reason };
        }
        return none;
    }

    // `kind` is 'drawing' | 'integration' | 'setup' — the module deliberately does NOT know
    // Rocketlane's category NAMES, so renaming a category upstream cannot silently break matching.
    function pickTask(tasks, kind, texts, used, prior) {
        // The `used` guard was applied only inside rescue() until v4.112, so a category whose evidence
        // pointed straight at a task another category had already taken that day booked onto it anyway —
        // despite "no two categories land on the same task" being the documented promise. Filtering here
        // makes it hold on every path, including the drawing-name exact match and the single-candidate
        // shortcuts, which returned before rescue was ever reached.
        const usedIds = new Set([...(used || [])].map(String));
        tasks = (tasks || []).filter(t => t && t.taskId != null && typeof t.taskName === 'string'
            && !BOOK_QTY_TASK_RE.test(t.taskName) && !BOOK_CHECKLIST_RE.test(t.taskName)
            && !usedIds.has(String(t.taskId)));
        if (!tasks.length) return null;
        // TIERED evidence, strongest first — a later tier is consulted ONLY when every earlier one is
        // silent, so adding a tier can never overrule evidence that already decided:
        //   w1  device tokens + changed graphic names — system-level truth about what the day changed.
        //   wLog what YOU wrote in the operations log / a handover note that day (v4.112). Human, specific,
        //        and often the only evidence there is: a day spent on the phone or in the Designer leaves
        //        no config commit at all, and used to fall straight through to an alphabetical guess.
        //        Ranked under w1 (a note can mention work not done) but over unit names, which the 4.82
        //        deep-dive showed to be actively misleading.
        //   w2  unit NAMES — on MQTT projects the wireless sensors get renamed "Kjøttdisk"/"Fryserom",
        //        which would otherwise drag every day into refrigeration.
        const gStr = (texts.drawingNames || []).join(' ');
        const w1 = bookDiscWeights((texts.tokStr || '') + ' ' + gStr);
        const wLog = bookDiscWeights(texts.logStr || '', true); // human prose ⇒ word-boundary matching
        const w2 = bookDiscWeights(texts.uStr || '');
        const tiers = [w1, wLog, w2];
        // Everything the day wrote or changed, lowercased — the corpus bookNameHits ties are broken
        // against (v4.114). Built once; a tie between same-discipline tasks is then decided by which
        // task's NAME the day's own text actually mentions.
        const nameBlob = [texts.tokStr, texts.logStr, texts.uStr, gStr]
            .filter(Boolean).join(' ').toLowerCase();
        const tiered = (cands, stripRe) => {
            for (const w of tiers) {
                const hit = bookPickWeighted(cands, w, stripRe, false, prior, nameBlob);
                if (hit) return hit;
                if (Object.keys(w).length) return null; // this tier spoke and was ambiguous — do not fall through
            }
            return null;
        };
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
            // Rescue preserves the evidence hierarchy too: several weak unit-name words
            // must not outweigh a device token that identifies today's actual work.
            const strongest = tiers.find(w => Object.keys(w).length) || {};
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
                    // v4.114: a task whose name the day's own text mentions outranks everything else in
                    // a guess; v4.113: the booking-history prior outranks the fixed discipline order —
                    // "refrigeration first" was always a stand-in for exactly this, guessed rather than measured.
                    const best = list => list.filter(t => pool.includes(t))
                        .sort((a, b) => (bookNameHits(b.taskName, nameBlob) - bookNameHits(a.taskName, nameBlob))
                            || (bookPriorRank(prior, a) - bookPriorRank(prior, b))
                            || (discPri(a) - discPri(b)) || a.taskName.localeCompare(b.taskName))[0] || null;
                    const hit = bookPickWeighted(pool, strongest, /^[a-zæøå ]+\s*[:\-]/i, true, prior, nameBlob) || best(sigCands || []) || best(pool);
                    if (hit) return Object.assign({ rescued: true }, hit);
                }
            }
            return null;
        };
        if (kind === 'drawing') {
            // "Design: X" tasks plus bare Norwegian drawing tasks ("Maskinbilde", "VGV bilde", "Ny maskintegning…",
            // "Nytt oversiktsbilde", "Grafikk", "Skjermbilder", "System Image …").
            const design = tasks.filter(t => /^design\s*[:\-]/i.test(t.taskName) || /bilde|tegning|oversikt|grafikk|graphic|skjerm|visualis|image/i.test(t.taskName));
            const suf = t => bookNorm(t.taskName.replace(/^design\s*[:\-]/i, ''));
            // Compare ALL changed drawings before returning. A generic first name such as
            // "Overview" must not steal a later exact "Wireless overview" match.
            const drawings = [...new Set((texts.drawingNames || []).map(bookNorm).filter(Boolean))];
            const named = design.map(t => {
                const suffix = suf(t);
                let rank = 0, detail = 0;
                for (const n of drawings) {
                    const r = suffix === n ? 3 : suffix && suffix.includes(n) ? 2 : suffix && n.includes(suffix) ? 1 : 0;
                    const d = r === 2 ? n.length : suffix.length;
                    if (r > rank || (r === rank && d > detail)) { rank = r; detail = d; }
                }
                return { t, rank, detail };
            }).filter(x => x.rank > 0).sort((a, b) => b.rank - a.rank || b.detail - a.detail
                || Number(a.t.done) - Number(b.t.done) || bookPriorRank(prior, a.t) - bookPriorRank(prior, b.t)
                || a.t.taskName.localeCompare(b.t.taskName) || String(a.t.taskId).localeCompare(String(b.t.taskId)));
            if (named.length) {
                const a = named[0], b = named[1];
                const ambiguous = b && a.rank === b.rank && a.detail === b.detail;
                return ambiguous ? Object.assign({ rescued: true }, a.t) : a.t;
            }
            // Drawing names outrank device evidence for drawing work, including the language
            // bridge (Ventilasjon → Ventilation). Combine names before deciding.
            const drawingHit = bookPickWeighted(design, bookDiscWeights(gStr, true), /^design\s*[:\-]/i, false, prior, gStr.toLowerCase());
            if (drawingHit) return drawingHit;
            if (design.length === 1) return design[0];
            // Fences: setup names stay out longest; integration names are relaxed first.
            return resolve(design, /^design\s*[:\-]/i) || rescue(design, [/ak3|scan\b|gateway|\brac\b|nport|server|port\s*forward/i, /integra(?:tion|sjon)/i]);
        }
        if (kind === 'integration') {
            let cands = tasks.filter(t => /^integra(?:tion|sjon)\s*[:\-]/i.test(t.taskName));
            if (!cands.length) // no Integration:-prefixed tasks — bare-discipline or generic commissioning work packages
                cands = tasks.filter(t => /^(refrigeration|ventilation|heating|heat|energy|energi|machine room|wireless)\b/i.test(t.taskName)
                    || /konfig|igangkj|i?driftsett|commission|innregul|integrasjon|oppkobling|programmering|oppstart/i.test(t.taskName));
            if (cands.length === 1) return cands[0];
            // Fences: design names stay out longest; setup names are relaxed first.
            return resolve(cands, /^integra(?:tion|sjon)\s*[:\-]/i) || rescue(cands, [/design|bilde|tegning/i, /ak3|scan\b|gateway|\brac\b|nport|server|port\s*forward/i]);
        }
        if (kind === 'setup') {
            // NPort/Moxa = serial gateway; "Server configured" / "Port forwarding" / "Connection to the
            // plant" (Hardware & Network phases) are gateway-setup work too.
            const c = tasks.filter(t => /(ak3|scan|gateway|rac|nport|server|moxa|router|nettverk|network)\b|port\s*forward|forbindelse|tilkobling|connection/i.test(t.taskName));
            if (c.length === 1) return c[0];
            // Setup work often has no discipline words. Match its specific equipment/tool
            // name in today's evidence before the fixed gateway fallback, strongest source first.
            // Generic workflow words (configured/setup) alone do not distinguish equipment.
            for (const blob of [texts.tokStr, texts.logStr, texts.uStr]) {
                const named = c.map(t => ({ t, score: bookNameHits(t.taskName, String(blob || '').toLowerCase()) }))
                    .filter(x => x.score > 0).sort((a, b) => b.score - a.score || Number(a.t.done) - Number(b.t.done)
                        || bookPriorRank(prior, a.t) - bookPriorRank(prior, b.t));
                if (named.length && (named.length === 1 || named[0].score > named[1].score)) return named[0].t;
                if (named.length) break; // ambiguous strong evidence must not be displaced by weaker text
            }
            const hit = resolve(c, /^[a-zæøå ]+[:\-]/i);
            if (hit) return hit;
            // No evidence distinguishes gateway tasks — walk a fixed priority over the OPEN ones instead
            // of giving up (gateway-est name first).
            for (const re of [/gateway/i, /ak3|scan\b/i, /\brac\b/i, /nport|moxa/i, /server/i, /port\s*forward/i, /connection|forbindelse|tilkobling/i, /network|nettverk/i])
                { const t = c.find(x => !x.done && re.test(x.taskName) && !(used && used.has(x.taskId))); if (t) return Object.assign({ rescued: true }, t); }
            // Fences: design names stay out longest — gateway setup is integration-side work, so an
            // Integration task is the natural second choice ("Setup 18m → Design: Energi" was wrong).
            return rescue(c, [/design|bilde|tegning/i, /integra(?:tion|sjon)/i]);
        }
        if (kind === 'support') {
            // Follow-up / troubleshooting work packages (v4.114). Deliberately NARROW: only a task whose
            // name says support-like work qualifies, and there is NO rescue pass — most projects carry
            // no such task, and a "Support" entry reads better as its own activity than force-fitted
            // onto "Integration: …". ("Service order"-style rows are already checklist-excluded.)
            const c = tasks.filter(t => /support|service|oppf.lg|feils.k|troubleshoot/i.test(t.taskName) && !BOOK_CHECKLIST_RE.test(t.taskName));
            if (!c.length) return null;
            if (c.length === 1) return c[0];
            return resolve(c, /^[a-zæøå ]+[:\-]/i);
        }
        return null;
    }

    return {
        TASK_DISCIPLINES, BOOK_QTY_TASK_RE, BOOK_CHECKLIST_RE,
        bookNorm, bookDiscOf, bookDiscWeights, bookNameHits, bookPickWeighted, pickTask, findProjectForPlant, SHELL_TASKS_MAX,
    };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Object.assign({}, RL_RECAP_ALL_LOGS, RL_RECAP_NOTE_TEXT, RL_RECAP_TIME, RL_RECAP_CAL, RL_RECAP_MATCH);

(function () {
    'use strict';

    // Under Node (the helper unit tests require this file) there is no userscript host: bail out
    // before touching location/GM storage. The helpers above are already exported.
    if (typeof GM_xmlhttpRequest !== 'function') return;

    const {
        ALL_LOGS_SECRET_RE, ALL_LOGS_NOTE_CAP, allLogsDateWindow, maskAllLogsComment,
        visitsFromAllLogsRecords, formatAllLogsNotes, mergeVisitEventLists,
    } = RL_RECAP_ALL_LOGS;

    const {
        summarizeIntegration, summarizeDrawing, summarizeActions, composeEntryNote,
        summarizeLeadIntegration, summarizeLeadDrawing, summarizeLeadSetup, summarizeLeadSupport,
        summarizeLeadActions,
    } = RL_RECAP_NOTE_TEXT;

    const { cappedGapCredit, dayEndExtension } = RL_RECAP_TIME;

    const { calNormalizeEvent, calAllocate, calRemainingWorkday, calEntryNote, calClock, weekCheckupPlan, calErrorFor, calNeedsSignin } = RL_RECAP_CAL;

    const { pickTask, bookDiscWeights, findProjectForPlant } = RL_RECAP_MATCH;

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
    const KEY_LAST_FULL_SCAN  = 'last_full_scan_date';      // 'YYYY-MM-DD' (Oslo) of the last COMPLETED full scan — drives the once-a-day recommendation
    const KEY_FULLSCAN_NUDGE  = 'fullscan_nudge_dismissed'; // 'YYYY-MM-DD' the recommendation was dismissed on
    const SCRIPT_VERSION   = '4.134';
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
    // Transition evidence (v4.114): a capped silence and the day's final wrap-up are re-judged
    // against the plant's own change-triggered commits — the constants bundle RL_RECAP_TIME's pure
    // credit functions read. wrapMin = the short wrap-up credited past the last proving commit.
    const GAP_COMMIT_WRAP_MIN = 5;
    const GAP_CREDIT_C = {
        capMin: Math.round(ACTIVE_CAP_MS / 60000), longGapMs: LONGGAP_MS,
        evidenceMs: LONGGAP_EVIDENCE_MS, dampMin: LONGGAP_CREDIT_MIN,
        wrapMin: GAP_COMMIT_WRAP_MIN, tailMin: Math.round(TAIL_MS / 60000),
        maxAfterMs: COMMIT_SESSION_MAX_MS,
    };
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

    // ===== Outlook calendar harvest (v4.117) ========================================================
    // Meetings and admin time never touch pang, so the panel could only ever see plant work — and
    // since the day is distributed to a 7,5 h total, meeting time was silently absorbed into the
    // plant estimates. The calendar closes that hole.
    //
    // ⚠ THE ACCESS TOKEN NEVER LEAVES OUTLOOK'S ORIGIN. Outlook's SPA keeps an MSAL cache in its own
    // localStorage; the token is read there, used there, and only the resulting EVENTS (subject,
    // start, end, flags) are written to GM storage. Storing the token would put a live M365
    // credential on disk for an hour at a time — deliberately not done. Consequences: the harvest
    // needs an Outlook tab (opened in the background, like the pang harvest), and it re-reads the
    // token every run because it expires in ~1 h.
    //
    // Two API notes, both measured live (2026-08-31): the legacy REST endpoint returns 401 for
    // cookie auth (`credentials: 'include'` is not enough — it wants the bearer), and without the
    // `Prefer: outlook.timezone` header every time comes back UTC, which would book an 08:30 meeting
    // as 06:30. This tenant has no X-OWA-CANARY cookie, so the OWA service route does not apply.
    const CAL_HOSTS = new Set(['outlook.office.com', 'outlook.office365.com', 'outlook.cloud.microsoft']);
    const CAL_REST = 'https://outlook.office.com/api/v2.0/me/calendarview';
    const CAL_TZ = 'W. Europe Standard Time';
    const KEY_CAL_REQUEST = 'cal_request';   // { at, dates:[iso] } — written by Rocketlane, read in the Outlook tab
    const KEY_CAL_RESULT  = 'cal_result';    // { at, byDate:{iso:[event]}, error } — written back by the Outlook tab
    const KEY_CAL_DONE    = 'cal_done_ts';   // harvest completion signal, same pattern as KEY_HARVEST_DONE
    const KEY_CAL_ENABLED = 'cal_enabled';   // user toggle — the panel, and Book week's head + check-up
    const KEY_CAL_ASKED   = 'cal_ask_date';  // 'YYYY-MM-DD' Book week last ASKED about the calendar (v4.129)
    // Rocketlane REQUIRES a project on every time entry (verified live: 160 historical entries, zero
    // project-less; the activities dialog keeps its submit disabled until a project is chosen), and
    // this tenant has no meetings/admin project. So calendar rows book against a project the user
    // picks once in the review UI — remembered here, exactly like the team-bucket fallback.
    const KEY_CAL_PROJECT      = 'cal_project';
    const KEY_CAL_PROJECT_NAME = 'cal_project_name';
    const KEY_PROJECT_PICK     = 'project_pick';     // { '<plant number>': projectId } — the user's choice between twin projects (v4.134)

    // Find a live Outlook access token in the SPA's MSAL cache. Entries are JSON blobs keyed by
    // account/scope; the one we want is credentialType AccessToken, targets a Calendars scope, and
    // has not expired. Returns the token string or ''. Never logged, never stored.
    function calFindToken() {
        let best = null;
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (!k || !/accesstoken/i.test(k)) continue;
            let v = null;
            try { v = JSON.parse(localStorage.getItem(k)); } catch { continue; }
            if (!v || String(v.credentialType || '') !== 'AccessToken' || !v.secret) continue;
            const target = String(v.target || '');
            if (!/calendars\.read/i.test(target) && !/outlook\.office\.com/i.test(target)) continue;
            const exp = (+v.expiresOn || 0) * 1000; // MSAL stores seconds
            if (exp && exp < Date.now() + 60000) continue; // expiring within a minute — useless
            if (!best || exp > best.exp) best = { secret: v.secret, exp };
        }
        return best ? best.secret : '';
    }

    // Runs in ANY Outlook tab. Two roles (v4.122):
    //  - a tab the SCRIPT opened (#rl-cal) serves the pending request once and closes itself;
    //  - a tab THE USER already had open stays put and answers requests as they arrive, via
    //    GM_addValueChangeListener. That is the discreet path: when Outlook is already open,
    //    reading the calendar opens nothing at all and the user sees no tab appear.
    function syncFromOutlook() {
        const isSyncTab = location.hash.includes('rl-cal') || window.name === 'rl_cal_sync';
        if (isSyncTab) { calServeRequest(GM_getValue(KEY_CAL_REQUEST, null), true); return; }
        // An ordinary Outlook tab: answer the request that is pending right now (if any), then keep
        // listening for later ones for as long as the user leaves this tab open.
        calServeRequest(GM_getValue(KEY_CAL_REQUEST, null), false);
        try {
            if (typeof GM_addValueChangeListener === 'function') {
                GM_addValueChangeListener(KEY_CAL_REQUEST, (name, oldV, newV, remote) => {
                    if (remote) calServeRequest(newV, false); // `remote` = written by the Rocketlane tab
                });
            }
        } catch {}
    }

    let _calServing = false;
    async function calServeRequest(req, isSyncTab) {
        const dates = (req && Array.isArray(req.dates)) ? req.dates.filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)) : [];
        // Only answer a LIVE request: a stale one left in storage would otherwise be re-served by
        // every Outlook tab on every page load, and the answer would look fresh to a later caller.
        const fresh = req && (Date.now() - (+req.at || 0) < 60000);
        if (!dates.length || (!isSyncTab && !fresh) || _calServing) {
            if (isSyncTab) setTimeout(() => { try { window.close(); } catch {} }, 250);
            return;
        }
        _calServing = true;
        const finish = (payload) => {
            _calServing = false;
            try { GM_setValue(KEY_CAL_RESULT, Object.assign({ at: Date.now() }, payload)); } catch {}
            try { GM_setValue(KEY_CAL_DONE, Date.now()); } catch {}
            if (isSyncTab) setTimeout(() => { try { window.close(); } catch {} }, 250);
        };
        // The SPA writes its MSAL cache during boot; a freshly opened tab may not have it yet. An
        // already-loaded tab has it immediately, which is why the discreet path is also the fast one.
        let token = '';
        for (let tries = 0; tries < (isSyncTab ? 40 : 4) && !token; tries++) {
            token = calFindToken();
            if (!token) await new Promise(r => setTimeout(r, 500));
        }
        if (!token) { finish(Object.assign({ byDate: {} }, calErrorFor('no-token'))); return; }
        const byDate = {};
        try {
            for (const iso of dates) {
                const url = `${CAL_REST}?startDateTime=${iso}T00:00:00&endDateTime=${iso}T23:59:59`
                    + '&$orderby=Start/DateTime&$top=100';
                const r = await fetch(url, {
                    headers: {
                        Authorization: 'Bearer ' + token,
                        Accept: 'application/json',
                        Prefer: `outlook.timezone="${CAL_TZ}"`, // else every time comes back UTC
                    },
                });
                // A refused request is not an empty day (v4.132) — it used to be silently booked as one.
                if (!r.ok) { finish(Object.assign({ byDate }, calErrorFor('http', r.status))); return; }
                const j = await r.json();
                byDate[iso] = (Array.isArray(j && j.value) ? j.value : [])
                    .map(calNormalizeEvent).filter(Boolean);
            }
            finish({ byDate });
        } catch (e) {
            finish(Object.assign({ byDate }, calErrorFor('exception')));
        }
    }

    // Called from Rocketlane: ask Outlook for these dates. Discretion order (v4.122):
    //  1. an Outlook tab the user ALREADY has open answers over GM_addValueChangeListener — nothing
    //     is opened, nothing appears in the tab strip, and it is the fastest path too (the MSAL cache
    //     is already warm). Waited on for CAL_QUIET_WAIT_MS before giving up on it.
    //  2. otherwise a background tab is opened at the END of the tab strip (`insert: false`, so it
    //     does not push itself in beside what the user is looking at) and closed the moment it
    //     answers — typically a few seconds.
    // Either way `active: false` means focus never leaves Rocketlane.
    const CAL_QUIET_WAIT_MS = 2500;
    function calFetchDays(isoDates, timeoutMs = 30000) {
        return new Promise(resolve => {
            const dates = [...new Set((isoDates || []).filter(Boolean))];
            if (!dates.length) { resolve({ byDate: {} }); return; }
            const startedAt = Date.now();
            let tab = null, settled = false;
            const answered = () => GM_getValue(KEY_CAL_DONE, 0) > startedAt;
            const done = (payload) => {
                if (settled) return;
                settled = true;
                clearInterval(tick);
                setTimeout(() => { try { if (tab) tab.close(); } catch {} resolve(payload); }, tab ? 300 : 0);
            };
            const readResult = () => {
                const res = GM_getValue(KEY_CAL_RESULT, null);
                return (res && res.at >= startedAt) ? { byDate: res.byDate || {}, error: res.error, code: res.code } : null;
            };
            try { GM_setValue(KEY_CAL_REQUEST, { at: startedAt, dates }); } catch {}
            const tick = setInterval(() => {
                if (answered()) { done(readResult() || Object.assign({ byDate: {} }, calErrorFor('no-answer'))); return; }
                // Give an already-open tab first refusal; only then open one of our own.
                if (!tab && Date.now() - startedAt > CAL_QUIET_WAIT_MS) {
                    try {
                        if (typeof GM_openInTab === 'function') {
                            tab = GM_openInTab('https://outlook.office.com/calendar/view/day#rl-cal',
                                { active: false, insert: false, setParent: true });
                        }
                    } catch {}
                    if (!tab) { done(Object.assign({ byDate: {} }, calErrorFor('open'))); return; }
                }
                // We opened a tab and it never answered: the script did not run there, which is what a
                // redirect to the Microsoft login page looks like from here (v4.132).
                if (Date.now() - startedAt > timeoutMs) done(Object.assign({ byDate: {} }, calErrorFor('timeout')));
            }, 250);
        });
    }

    // One day of calendar, ready to book: [{ ev, minutes, categoryKind }]. Cached per date for the
    // session so re-opening a day never re-opens Outlook.
    const _calCache = new Map(); // iso -> { at, rows, error }
    const CAL_TTL_MS = 10 * 60 * 1000;
    // A sign-in failure is latched for a minute (v4.132): Book week asks for five days in a row, and
    // each would otherwise open a tab and wait the full timeout before reporting the same thing. The
    // "Sign in to Outlook" button, the 🗓 toggles and ↻ all clear it, so a retry after signing in asks
    // Outlook again.
    let _calSigninFailedAt = 0;
    function calResetSignin() { _calSigninFailedAt = 0; }
    async function calRowsForDate(iso, workdayMin) {
        if (!GM_getValue(KEY_CAL_ENABLED, false)) return { rows: [] };
        if (_calSigninFailedAt && Date.now() - _calSigninFailedAt < 60000) return Object.assign({ rows: [] }, calErrorFor('no-token'));
        const hit = _calCache.get(iso);
        if (hit && Date.now() - hit.at < CAL_TTL_MS) return { rows: calPrice(hit.events, workdayMin), error: hit.error };
        const res = await calFetchDays([iso]);
        const events = (res.byDate && res.byDate[iso]) || [];
        // An unavailable calendar is not evidence of an empty day; let the next preview retry.
        if (!res.error) _calCache.set(iso, { at: Date.now(), events });
        if (calNeedsSignin(res.code)) _calSigninFailedAt = Date.now();
        return { rows: calPrice(events, workdayMin), error: res.error, code: res.code };
    }
    function calPrice(events, workdayMin) {
        return calAllocate(events || [], workdayMin, ROUND_TO_MIN)
            .filter(a => a.minutes > 0)
            .map(a => ({ ev: a.ev, minutes: a.minutes, category: CAL_CATEGORY[a.ev.kind] || CAL_CATEGORY.internal }));
    }
    // kind → the tenant's category NAME (verified live 2026-08-31: all four exist).
    const CAL_CATEGORY = {
        internal: 'Meeting - Internal',
        external: 'Meeting - External',
        planning: 'Admin - Planning',
        training: 'Training - Internal',
    };

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
                    let list = null;
                    try {
                        if (r.status === 200) {
                            const p = JSON.parse(r.responseText), res = Array.isArray(p) ? p[0] : p;
                            if (!res?.error && Array.isArray(res?.result)) list = res.result;
                        }
                    } catch {}
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
                // Missing/failed history stays undefined: it must not prove there were no saves.
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

    // ---- Once-a-day full-scan recommendation (v4.109) ----
    // A quick scan only covers your recent + previously-visited plants, so work done through
    // plant-admin/designer stays invisible until a full scan runs. One full scan caches every date it
    // finds, so a single sweep a day keeps the whole week honest — the panel recommends one when it
    // opens and stays quiet for the rest of the day once a scan has run (or the tip was dismissed).
    // The day boundary is Oslo local, matching every other date in the script.
    const markFullScanRan = () => { try { GM_setValue(KEY_LAST_FULL_SCAN, todayISO()); } catch (e) {} };
    const fullScanRanToday = () => GM_getValue(KEY_LAST_FULL_SCAN, '') === todayISO();
    const shouldNudgeFullScan = () => !fullScanRanToday() && GM_getValue(KEY_FULLSCAN_NUDGE, '') !== todayISO();

    // Cross-plant time attribution for a set of visits that still carry their `_events`. Flattens every
    // click into one timeline, credits each gap to the plant that was open across it, and stamps the
    // time fields, then drops `_events`. Extracted from loadVisitsForDate (v4.110) so the All logs path
    // gets the identical estimator instead of a second implementation.
    //
    // Only feed it visits from ONE gathering pass: the timeline is cross-plant, so mixing already-stamped
    // visits with fresh ones would re-credit gaps that were already accounted for.
    function stampVisitTime(visits) {
        const pending = (visits || []).filter(v => Array.isArray(v._events) && v._events.length);
        if (!pending.length) return visits || [];
        const allEvents = [];
        for (const v of pending) for (const e of v._events) allEvents.push({ plant_id: v.plant_id, ts: e.ts, action: e.action });
        const { minutes: minsByPlant, cappedGaps } = attributeTime(allEvents);
        const draw = designerGapByPlant(allEvents);
        for (const v of pending) {
            v.estimated_minutes = minsByPlant[v.plant_id] || 0;
            v.base_minutes = v.estimated_minutes; // immutable click-only floor; commit fusion adds on top in ensureChangesEnriched
            v.designer_minutes = draw.minutes[v.plant_id] || 0;      // gap-after-Designer = real Drawing time (v4.54)
            v.designer_last = draw.lastSession[v.plant_id] || null;  // last designer session {s,e} — commit-extendable (v4.60)
            v.capped_gaps = cappedGaps[v.plant_id] || [];            // long silences, re-judged against commits (v4.56)
            delete v._events;
        }
        return visits;
    }

    async function loadVisitsForDate(isoDate, plantIds, onProgress, opts) {
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
                    // click:true — every pang history row IS a click. All logs adds non-click evidence
                    // rows (notes, operations log), so the flag has to be explicit once both merge.
                    _events: matches.map(m => ({ ts: tsFromPangDate(m.date), action: m.action, click: true })),
                });
            }
            donePlants += batch.length;
            foundCount += found.length;
            onProgress?.(donePlants, plantIds.length, foundCount);
            return found;
        }, SCAN_PARALLEL);

        const visits = perBatch.flat().sort((a, b) => a.first_ts - b.first_ts);

        // Cross-plant time attribution: flatten every action timestamp into one timeline, then credit
        // each gap (capped at ACTIVE_CAP_MS) to the plant that was open across it. `opts.keepEvents`
        // defers this so a caller can first union these visits with All logs rows and stamp once.
        if (!(opts && opts.keepEvents)) stampVisitTime(visits);

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

    // ===== IWMAC "All logs" (internal.iwmac.local) ==================================================
    // The All logs tool answers exactly the question this panel asks — "what did user X do on date Y" —
    // in ONE request, across the whole fleet, and it includes activity pang never sees: handover notes,
    // operations-log entries (alarm settings, duty lists), service logons, alarm calls. pang's
    // get_history has no server-side user/date filter, so the old path had to read up to ~7,600 plants'
    // full history to answer the same thing.
    //
    // Two things it is NOT: (1) a replacement for the full scan — that still feeds the multi-date cache
    // and the plant footprint; (2) reachable without a session. Unlike pang (network-authed), this host
    // wants the browser's login cookie, so the request runs with `anonymous: false` and simply fails
    // when the user has not logged into internal.iwmac.local. Every caller therefore keeps its pang path.
    const ALL_LOGS_URL = 'http://internal.iwmac.local/tools/all_logs/service.php';
    const ALL_LOGS_TIMEOUT_MS = 15000;            // a whole fleet-day measured 169 ms; 15 s is already generous
    const ALL_LOGS_TTL_TODAY_MS = 2 * 60 * 1000;  // today keeps growing — re-ask often
    const ALL_LOGS_TTL_PAST_MS = 30 * 60 * 1000;  // a past day is settled
    const ALL_LOGS_DOWN_TTL_MS = 5 * 60 * 1000;   // off the office network every call would burn the full timeout
    const _allLogsCache = new Map(); // 'user|iso' -> { at, res }
    let _allLogsDownUntil = 0;       // set after a failure so a whole week of dates fails fast, not 5×15 s

    // One day of All logs for one user. Returns { ok, records, limit_reached } — never throws.
    // `user` is sent EXACT: the server matches it as a substring, and "thomas" would also return every
    // other Thomas. Client-side filtering (normalizeUser) still runs, because the log stores some users
    // as bare names and others as e-mail addresses.
    async function gmFetchAllLogs(isoDate, username) {
        if (!username) return { ok: false };
        const key = username + '|' + isoDate;
        const ttl = isoDate === todayISO() ? ALL_LOGS_TTL_TODAY_MS : ALL_LOGS_TTL_PAST_MS;
        const hit = _allLogsCache.get(key);
        if (hit && Date.now() - hit.at < ttl) return hit.res;
        if (Date.now() < _allLogsDownUntil) return { ok: false };
        const win = allLogsDateWindow(isoDate);
        const body = JSON.stringify({ cmd: 'load', user: username, date_from: win.date_from, date_to: win.date_to });
        const res = await new Promise(resolve => {
            GM_xmlhttpRequest({
                method: 'POST',
                url: ALL_LOGS_URL,
                headers: { 'Content-Type': 'application/json' },
                data: body,
                anonymous: false, // the tool is session-authed — the login cookie must ride along
                timeout: ALL_LOGS_TIMEOUT_MS,
                onload: r => {
                    try {
                        const parsed = JSON.parse(r.responseText);
                        if (parsed && parsed.status === 'ok' && Array.isArray(parsed.records)) {
                            resolve({ ok: true, records: parsed.records, limit_reached: !!parsed.limit_reached });
                        } else {
                            resolve({ ok: false });
                        }
                    } catch { resolve({ ok: false }); }
                },
                onerror: () => resolve({ ok: false }),
                ontimeout: () => resolve({ ok: false }),
            });
        });
        if (res.ok) { _allLogsDownUntil = 0; _allLogsCache.set(key, { at: Date.now(), res }); }
        else { _allLogsDownUntil = Date.now() + ALL_LOGS_DOWN_TTL_MS; } // don't cache a failure as a day's answer
        return res;
    }

    // Build a full day's visits from All logs. Returns null when the tool is unreachable / the session
    // is missing, so callers fall back to pang. `opts.keepEvents` defers time stamping (for merging).
    async function tryLoadVisitsFromAllLogs(isoDate, opts) {
        const username = effectiveUsername();
        if (!username) return null;
        const fetched = await gmFetchAllLogs(isoDate, username);
        if (!fetched.ok) return null;
        const names = GM_getValue(KEY_PLANT_NAMES, {});
        const visits = visitsFromAllLogsRecords(fetched.records, username, null, tsFromPangDate);
        for (const v of visits) if (!v.name) v.name = cachedPlantName(names, v.plant_id);
        if (!(opts && opts.keepEvents)) stampVisitTime(visits);
        return {
            visits,
            username,
            // The panel reads scanned === 0 as "no plants known yet" and shows the pang onboarding hint.
            // All logs queries the whole fleet in one call, so there is no per-plant count to report.
            scanned: Math.max(visits.length, 1),
            usersOnDate: [],
            limit_reached: !!fetched.limit_reached,
        };
    }

    // Union two UNSTAMPED visit sets for the same date (both still carrying `_events`). Used when
    // All logs was truncated (limit_reached) and pang has to fill the gap.
    function overlayAllLogsVisits(pangVisits, logVisits) {
        const byId = new Map();
        for (const v of (pangVisits || [])) byId.set(String(v.plant_id), v);
        for (const lv of (logVisits || [])) {
            const id = String(lv.plant_id);
            const base = byId.get(id);
            if (!base) { byId.set(id, lv); continue; }
            base._events = mergeVisitEventLists(base._events, lv._events);
            base.first_ts = base._events[0].ts;
            base.last_ts = base._events[base._events.length - 1].ts;
            base.actions = [...new Set([...(base.actions || []), ...(lv.actions || [])])];
            base.action_counts = base.action_counts || {};
            for (const [a, n] of Object.entries(lv.action_counts || {})) base.action_counts[a] = Math.max(base.action_counts[a] || 0, n);
            base.all_logs_notes = [...new Set([...(base.all_logs_notes || []), ...(lv.all_logs_notes || [])])].slice(0, ALL_LOGS_NOTE_CAP);
            base.count = base._events.filter(e => e.click !== false).length || base._events.length;
        }
        return [...byId.values()].sort((a, b) => a.first_ts - b.first_ts);
    }

    // Overlay All logs onto visits whose minutes are ALREADY stamped (a cached full scan). Existing
    // plants only gain chips, notes and a widened window — their minutes are deliberately left alone,
    // because re-running the cross-plant estimator over a mixed timeline would double-credit gaps.
    // Plants All logs found that the cache never saw are added and stamped on their own.
    function overlayAllLogsOntoStampedVisits(stamped, logVisits) {
        const byId = new Map();
        for (const v of (stamped || [])) byId.set(String(v.plant_id), v);
        const extras = [];
        for (const lv of (logVisits || [])) {
            const id = String(lv.plant_id);
            const base = byId.get(id);
            if (!base) { extras.push(lv); continue; }
            base.actions = [...new Set([...(base.actions || []), ...(lv.actions || [])])];
            base.action_counts = base.action_counts || {};
            for (const [a, n] of Object.entries(lv.action_counts || {})) base.action_counts[a] = Math.max(base.action_counts[a] || 0, n);
            base.all_logs_notes = [...new Set([...(base.all_logs_notes || []), ...(lv.all_logs_notes || [])])].slice(0, ALL_LOGS_NOTE_CAP);
            if (lv.first_ts && (!base.first_ts || lv.first_ts < base.first_ts)) base.first_ts = lv.first_ts;
            if (lv.last_ts && (!base.last_ts || lv.last_ts > base.last_ts)) base.last_ts = lv.last_ts;
        }
        if (extras.length) stampVisitTime(extras); // isolated: never mixed with the already-credited timeline
        return [...byId.values(), ...extras].sort((a, b) => a.first_ts - b.first_ts);
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
        const sorted = events.filter(e => e && e.plant_id != null && String(e.plant_id).trim() && Number.isFinite(e.ts)).sort((a, b) =>
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
        // Round the timeline total once, then apportion it. A burst of one-second visits
        // must not manufacture a whole minute for every plant.
        const ids = Object.keys(minutes), weights = ids.map(id => minutes[id]);
        const rounded = RL_RECAP_TIME.allocateMinutes(weights, weights.reduce((a, b) => a + b, 0) / 60000);
        ids.forEach((id, i) => { minutes[id] = rounded[i]; });
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
        const sorted = events.filter(e => e && e.plant_id != null && String(e.plant_id).trim() && Number.isFinite(e.ts)).sort((a, b) => (a.ts - b.ts) || String(a.plant_id).localeCompare(String(b.plant_id)));
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

    // Distribute raw estimates to the exact available budget, including zero.
    // Five-minute units are preferred; any remaining real minutes are preserved.
    function normalizeMinutes(visits, targetMinutes, roundTo) {
        const allocated = RL_RECAP_TIME.allocateMinutes(visits.map(v => v.estimated_minutes || 0), targetMinutes, roundTo);
        for (let i = 0; i < visits.length; i++) visits[i].normalized_minutes = allocated[i];
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
        :is(#${PANEL_ID}, #${WEEK_ID}) .rl-inline-btn { font-size: 11px; line-height: 1.3; padding: 1px 7px; margin-left: 4px; border: 1px solid #b1520a; background: #fff; color: #b1520a; border-radius: 4px; cursor: pointer; }
        :is(#${PANEL_ID}, #${WEEK_ID}) .bookplan-nb { font-size: 10px; color: #525252; background: #f4f4f4; border-radius: 3px; padding: 1px 4px; margin-left: 4px; }
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
        #${WEEK_ID} .rl-week-info { font-size: 12px; color: #0e6027; padding: 2px 0 6px; }
        #${WEEK_ID} .rl-week-nav { float: right; display: inline-flex; gap: 4px; align-items: center; }
        #${WEEK_ID} .rl-week-cal { display: inline-flex; align-items: center; gap: 3px; font-size: 13px; font-weight: 400; cursor: pointer; padding: 0 4px; user-select: none; }
        #${WEEK_ID} .rl-week-cal input { margin: 0; cursor: pointer; }
        #${WEEK_ID} .rl-week-calask { display: flex; align-items: center; gap: 6px; margin: 6px 0 2px; font-size: 13px; cursor: pointer; }
        #${WEEK_ID} .rl-week-calask input { margin: 0; cursor: pointer; }
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
        #${PANEL_ID} .lognote:empty { display: none; }
        #${PANEL_ID} .lognote { margin-top: 4px; font-size: 11px; color: #6f6f6f; font-style: italic; }
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
        #${PANEL_ID} .fsnudge { margin: 10px 14px 0; padding: 8px 10px; border: 1px solid #f0d6b0; background: #fff4e5; border-radius: 6px; font-size: 11.5px; line-height: 1.4; color: #8a4a09; }
        #${PANEL_ID} .fsnudge b { color: #6b3906; }
        #${PANEL_ID} .fsnudge-btns { margin-top: 7px; display: flex; gap: 6px; }
        #${PANEL_ID} .fsnudge button { font-size: 11px; padding: 3px 10px; border: 1px solid #c6c6c6; border-radius: 5px; background: #fff; color: #161616; cursor: pointer; }
        #${PANEL_ID} .fsnudge button[data-action="nudge-go"] { background: #0f62fe; border-color: #0f62fe; color: #fff; font-weight: 600; }
        #${PANEL_ID} .fsnudge button[data-action="nudge-go"]:hover { background: #0353e9; }
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
            <div class="controls" style="border-top: 1px solid #f0f0f0; padding-top: 6px;">
                <label style="display: flex; align-items: center; gap: 4px; font-size: 12px; color: #525252; flex: 1;" title="Reads your Outlook calendar for the selected date and offers meetings, planning and training as timesheet entries. Meetings are booked at their real length FIRST; the plant distribution then splits whatever the workday has left. If you already have Outlook open in a tab, it is read there and nothing is opened; otherwise a background tab opens at the end of the tab strip for a few seconds and closes itself. The access token stays inside Outlook and is never stored.">
                    <input type="checkbox" data-field="calendar" ${GM_getValue(KEY_CAL_ENABLED, false) ? 'checked' : ''}>
                    🗓 Include calendar (meetings &amp; admin)
                </label>
            </div>
            <div class="fsnudge" hidden></div>
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
        const calendarChk   = panel.querySelector('[data-field=calendar]');
        const list          = panel.querySelector('.results');
        const nudgeEl       = panel.querySelector('.fsnudge');
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
            else if (lastMode === 'all_logs') source = ' · IWMAC All logs';
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
        // The calendar toggle only changes what a BOOKING reads (loadDayForBooking / Book day), so
        // nothing needs re-scanning here — flipping it off also drops the session cache, so turning
        // it back on re-asks Outlook rather than serving a stale day.
        calendarChk?.addEventListener('change', () => {
            GM_setValue(KEY_CAL_ENABLED, !!calendarChk.checked);
            if (!calendarChk.checked) _calCache.clear();
            calResetSignin();
            // Book week carries the same toggle (v4.128) — keep it in step when both are open.
            const wk = document.querySelector(`#${WEEK_ID} input[data-b="cal"]`);
            if (wk) wk.checked = !!calendarChk.checked;
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

        // Shared tail of every gathering path (All logs, quick/refresh pang, full scan): resolve missing
        // plant names, then publish the result to the panel. `mode` is the SOURCE label the footer shows.
        const finishScan = async (seq, iso, visits, username, scanned, mode, onProg) => {
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
                // Quick pang scope is partial (recent plants only) → nudge toward a Full scan, since the
                // visit may be on a brand-new plant you never opened in pang. An empty *All logs* day is
                // authoritative for the whole fleet, so it renders the plain "No data" message instead.
                renderQuickEmpty();
            } else {
                // Full/refresh/All logs already covered everything (or there are visits) → render normally;
                // an empty result shows the "No data for <date>" message in renderVisits.
                applyAndRender();
            }
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
                const iso = dateInput.value;

                // All logs answers "what did I do on this date" in ONE request and includes work pang
                // never records (handover notes, operations-log entries, service logons). Try it BEFORE
                // resolving a plant list: the pang scope checks below reject a user whose footprint is
                // still empty, even when All logs already knows the whole day.
                let allLogs = null;
                if (mode !== 'full') {
                    list.innerHTML = `<div class="empty">Querying IWMAC All logs…</div>`;
                    allLogs = await tryLoadVisitsFromAllLogs(iso, { keepEvents: true });
                    if (seq !== scanSeq) return;
                }
                const allLogsComplete = !!(allLogs && !allLogs.limit_reached);
                if (allLogsComplete) {
                    stampVisitTime(allLogs.visits);
                    progress.style.width = '100%';
                    lastFailed = 0;
                    rememberUserPlants(allLogs.username, allLogs.visits); // grows the pang fallback's scope too
                    await finishScan(seq, iso, allLogs.visits, allLogs.username, allLogs.scanned, 'all_logs', null);
                    return;
                }

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
                    markFullScanRan();      // the sweep happened — today's recommendation is satisfied
                    renderFullScanNudge();  // …so take the tip down even if this run is superseded below
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
                    // Display-only overlay: a full scan owns the multi-date cache, but the selected date
                    // can still gain the notes and operations-log activity pang cannot see. Runs AFTER
                    // the cache write on purpose — All logs data never enters full_scan_cache.
                    const al = await tryLoadVisitsFromAllLogs(iso);
                    if (seq !== scanSeq) return;
                    if (al && al.visits.length) visits = overlayAllLogsOntoStampedVisits(visits, al.visits);
                } else {
                    // When All logs was truncated (limit_reached) its rows are still real work — union
                    // them with the pang scan rather than dropping either source. Both sides therefore
                    // stay unstamped until the merge, so the estimator sees one timeline.
                    const merging = !!allLogs;
                    const r = await loadVisitsForDate(iso, plantIds, onProg, { keepEvents: merging });
                    if (seq !== scanSeq) return;
                    visits = merging ? stampVisitTime(overlayAllLogsVisits(r.visits, allLogs.visits)) : r.visits;
                    username = r.username || (allLogs && allLogs.username); scanned = r.scanned;
                    lastFailed = r.failed || 0;
                    rememberUserPlants(username, visits);
                    // A merged result is not a pure pang scan — caching it would make the cache claim
                    // coverage it does not have (and All logs is re-queried on every open anyway).
                    if (mode === 'refresh' && username && !lastFailed && !merging) writeCacheDates(username, { [iso]: visits }, scanned); // Refresh updates only this date
                }
                progress.style.width = '100%';
                await finishScan(seq, iso, visits, username, scanned, mode, onProg);
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
            // All logs is preferred over the cache, not just over a scan: it is one fast request, it is
            // never stale, and it carries activity (notes, operations log) the cached pang scan cannot
            // contain. A truncated reply (limit_reached) is not treated as complete.
            const al = await tryLoadVisitsFromAllLogs(iso);
            if (seq !== scanSeq) return;
            if (al && !al.limit_reached) {
                rememberUserPlants(al.username, al.visits);
                await finishScan(seq, iso, al.visits, al.username, al.scanned, 'all_logs', null);
                return;
            }
            if (cached) {
                if (seq !== scanSeq) return;
                let visits = cached.visits.map(v => ({ ...v }));
                // All logs was unreachable or truncated — still overlay whatever it did return, so the
                // chips and notes appear even when the cache supplies the minutes.
                if (al && al.visits.length) visits = overlayAllLogsOntoStampedVisits(visits, al.visits);
                lastVisits    = visits;
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

        // Once-a-day recommendation, shown when the panel opens (v4.109). It sits above the results so
        // it never competes with a scan's own status text, and it disappears for the rest of the day as
        // soon as a full scan runs — from here, from the 🔍 button, or from ⤴ Book week's own sweep.
        // "Not today" silences it until tomorrow; it always returns the next day.
        const renderFullScanNudge = () => {
            if (!shouldNudgeFullScan()) { nudgeEl.hidden = true; nudgeEl.textContent = ''; return; }
            nudgeEl.innerHTML = `
                <div><b>No full scan yet today.</b> What you see comes from your recent + previously-visited plants — visits made through plant-admin or the designer are missing until a full scan runs. One scan takes about a minute, briefly opens pang, and caches every date it finds.</div>
                <div class="fsnudge-btns">
                    <button type="button" data-action="nudge-go">🔍 Run full scan</button>
                    <button type="button" data-action="nudge-later">Not today</button>
                </div>`;
            nudgeEl.hidden = false;
            nudgeEl.querySelector('[data-action=nudge-go]').addEventListener('click', () => { nudgeEl.hidden = true; doScan('full'); });
            nudgeEl.querySelector('[data-action=nudge-later]').addEventListener('click', () => {
                GM_setValue(KEY_FULLSCAN_NUDGE, todayISO());
                nudgeEl.hidden = true;
            });
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

        renderFullScanNudge();
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
        // From IWMAC All logs (v4.110) — activity pang's click log never records. Labels are the
        // tool's own action names, not invented ones.
        pang_note:             { label: 'Note',             cat: 'other' },
        changed_alarm_settings:{ label: 'Alarm settings',   cat: 'edit' },
        change_duty_list:      { label: 'Duty list',        cat: 'other' },
        service:               { label: 'Service logon',    cat: 'access' },
        call_plant_link:       { label: 'Alarm call',       cat: 'other' },
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

    // What the operations log / a handover note said about this plant that day — the one thing pang's
    // click log can never tell you. Already masked upstream (a comment that looks like it carries a
    // credential arrives as "[redacted]"), and escaped here because it is user-written text.
    function logNoteLine(v) {
        // Re-mask at display time: a day cached before a secret-pattern widening (e.g. the v4.115
        // "PW:" fix) still carries the RAW comment in full_scan_cache — the stored text must never
        // reach the chip. maskAllLogsComment is a no-op on an already-clean note.
        const notes = [...new Set(((v && v.all_logs_notes) || []).map(maskAllLogsComment).filter(Boolean))];
        if (!notes.length) return '';
        const shown = notes.slice(0, 2).join(' · ');
        const title = notes.join('\n');
        const more = notes.length > 2 ? ` +${notes.length - 2} more` : '';
        return `<span title="${escapeHtml(title)}">📝 ${escapeHtml(shown)}${more}</span>`;
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
        actions: v.actions, action_counts: v.action_counts, count: v.count, estimated_minutes: v.base_minutes ?? v.estimated_minutes,
        base_minutes: (v.base_minutes != null ? v.base_minutes : v.estimated_minutes), // click-only floor (never the commit-topped value)
        designer_minutes: v.designer_base_minutes ?? v.designer_minutes ?? 0, // cache the click baseline, never the extended session
        designer_last: v.designer_last || null,    // v4.60: last designer session {s,e} for the commit-anchored extension
        capped_gaps: v.capped_gaps || [],          // v4.56: long-silence metadata so the evidence-gated damping works on cached dates too
        all_logs_notes: v.all_logs_notes || [],    // v4.110: masked All logs comments, so a cached day keeps them when the tool is down
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
        // The day's very last action across ALL plants: its flat tail wrap-up can be extended by that
        // plant's own save commit (dayEndExtension, v4.114).
        const dayLastTs = Math.max(0, ...visits.map(v => v.last_ts || 0));
        for (const v of visits) {
            const before = JSON.stringify([v.estimated_minutes, v.designer_minutes, v.changes_in_window, v.scheduled_in_window]);
            // Preserve the click-only baseline across repeat calls and cached/reopened days.
            if (v.base_minutes == null) v.base_minutes = v.estimated_minutes || 0;
            if (v.designer_base_minutes == null) v.designer_base_minutes = v.designer_minutes || 0;
            let adjustedBase = v.base_minutes;
            v.designer_minutes = v.designer_base_minutes;
            for (const key of ['longgap_cut_minutes', 'gap_commit_ext_minutes', 'designer_ext_minutes', 'tail_ext_minutes']) delete v[key];
            // A sparse-click visit that opened a CONFIG SURFACE (edit/access/vnc action) is a sub-tool
            // config session: the work happens in a tool that logs almost no pang clicks and the save
            // commits a while after your last click. For those, widen the window tail so the session-
            // ending commit is caught (for BOTH the badge and the time credit); else keep the tight window.
            const hasConfigAction = (v.actions || []).some(a => { const m = ACTION_META[a]; return m && (m.cat === 'edit' || m.cat === 'access' || m.cat === 'vnc'); });
            // Two clicks hours apart are separate visits, not one short config session.
            const sparseConfig = (v.count || 0) <= SPARSE_CLICK_MAX && hasConfigAction
                && (v.last_ts || v.first_ts) - v.first_ts <= COMMIT_SESSION_MAX_MS;
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
            // Transition evidence (v4.114 — a superset of the v4.56 long-silence damping). Every capped
            // 30-min gap credit is provisional; the plant's own change-triggered commits inside the
            // silence re-judge it via cappedGapCredit: a commit inside the 60-min trust horizon proves
            // presence up to it (credit the span, LIFT-ONLY above the old cap), an unevidenced silence
            // longer than LONGGAP_MS damps to LONGGAP_CREDIT_MIN as before, and an ordinary capped gap
            // keeps its 30. This is what makes the estimate follow the real plant-to-plant transitions:
            // "when did I leave" now comes from the last save on the plant, not from a flat cap.
            // Skipped when the commits fetch failed (commits[..] undefined) or the visit came from a
            // pre-4.56 cache (no capped_gaps).
            const commitList = commits[v.plant_id];
            const trigAll = Array.isArray(commitList)
                ? commitList.filter(c => !isScheduledCommit(c)).map(c => tsFromPangDate(c.date))
                : null;
            if (trigAll && Array.isArray(v.capped_gaps) && v.capped_gaps.length) {
                let cut = 0, ext = 0;
                const capMin = GAP_CREDIT_C.capMin;
                for (const g of v.capped_gaps) {
                    if (!g || !(g.gap > ACTIVE_CAP_MS)) continue;
                    const credit = cappedGapCredit(g.gap, trigAll.map(t => t - g.ts), GAP_CREDIT_C);
                    if (credit < capMin) cut += capMin - credit; else ext += credit - capMin;
                }
                if (cut || ext) {
                    adjustedBase = Math.max(0, adjustedBase - cut + ext);
                    if (cut) v.longgap_cut_minutes = cut;    // for the verification dump
                    if (ext) v.gap_commit_ext_minutes = ext; // commit-proven presence past the 30-min cap
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
            // End-of-day transition (v4.114): the day's LAST action anywhere gets a flat 10-min tail —
            // but when this plant closed the day AND its own change-triggered commit lands within
            // 20 min after that last click, the save timestamps the real end of the day; credit up to
            // it (lift-only). Sparse config sessions are excluded — the commit fusion below already
            // prices those from the same commit, and adding here would double-count it.
            if (trigAll && !sparseConfig && v.last_ts && v.last_ts === dayLastTs) {
                const extra = dayEndExtension(v.last_ts, trigAll, GAP_CREDIT_C);
                if (extra > 0) {
                    adjustedBase += extra;
                    v.tail_ext_minutes = extra;
                }
            }
            // A single click that opened an ACCESS / VNC / diagnostics surface (phpMyAdmin, System tools,
            // Direct, Proxy, VNC, …) and committed NOTHING is a quick glance, not sustained work — yet the
            // 30-min gap cap can credit it up to 30 min. Cap its click-only floor to ISOLATED_TOUCH_CAP.
            // Edit surfaces (Designer/AK3) and server actions are deliberate work and are NOT capped. Uses
            // v.actions (set on both scan paths), so the cap now also applies on quick/single-date scans. (v4.53, R-g)
            if (Array.isArray(commitList) && (v.count || 0) === 1 && triggered.length === 0 && (v.actions || []).length === 1) {
                const cat0 = (ACTION_META[v.actions[0]] || {}).cat;
                if (cat0 === 'access' || cat0 === 'vnc' || cat0 === 'diag') {
                    adjustedBase = Math.min(adjustedBase, ISOLATED_TOUCH_CAP);
                }
            }
            // Time fusion — additive, bounded, idempotent (always recomputed from the click baseline, so
            // repeated re-renders never compound). For a sparse config session, credit the real active
            // span [first click → last triggered commit], clamped to [MIN, MAX], and lift estimated_minutes
            // to it when the click-only base is lower. Click-heavy plants never qualify, so addMs stays 0.
            const base = adjustedBase;
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
            if (before !== JSON.stringify([v.estimated_minutes, v.designer_minutes, v.changes_in_window, v.scheduled_in_window])) any = true;
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
    function rlFindProject(list, plantId, lastBooked) { // v4.133: see RL_RECAP_MATCH.findProjectForPlant
        return findProjectForPlant(list, plantId, lastBooked).project;
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

    // ---- Booking-history prior (v4.113) ----------------------------------------------------------
    // Which task does THIS project + category usually get booked onto? Measured over Thomas's real
    // timesheet, 16 weeks / 168 entries on the categories the matcher serves (Team buckets excluded —
    // there the "task" is the plant's subtask, picked by plant id, not by the matcher):
    //
    //   most-frequent task for the pair ....... 76% (95/125)
    //   same task as the previous entry ....... 60% (53/89)
    //   pairs that only ever use ONE task ..... 58/79
    //
    // So the modal task is used, not the last one. This is a TIEBREAK ONLY — it ranks candidates the
    // evidence could not separate, and never overrides evidence. That boundary is the whole safety
    // argument: where it applies, the alternative was an alphabetical pick, so a self-reinforcing
    // choice is no worse than arbitrary while being right ~3 times in 4. Letting it outrank evidence
    // would instead cement any mistake it ever made, since the script reads back its own bookings.
    const PRIOR_WEEKS = 8;
    let _priorPromise = null;
    let _projectsRefreshedThisSession = false; // one forced re-read of the project inventory per session (v4.133)
    function rlTaskPrior() { // -> Promise<Map<`${projectId}|${categoryId}`, taskId[]>> (best first)
        if (_priorPromise) return _priorPromise;
        _priorPromise = (async () => {
            const out = new Map();
            const creds = rlCreds(); if (!creds) return out;
            const counts = new Map(); // key -> Map<taskId, {n, last}>
            const projLast = new Map(); // projectId -> last date booked — settles duplicate project numbers (v4.133)
            const monday = new Date(); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
            for (let w = 0; w < PRIOR_WEEKS; w++) {
                const m = new Date(monday); m.setDate(monday.getDate() - 7 * w);
                const mIso = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}-${String(m.getDate()).padStart(2, '0')}`;
                try {
                    const hit = _rlWeekCache.get(mIso);
                    let p = (hit && Date.now() - hit.t < 60000) ? hit.p : null;
                    if (!p) { p = rlFetch('GET', `/users/${creds.userId}/timesheets/${mIso}?useNewLogic=true&sourcePage=MY_TIME_SHEET`); _rlWeekCache.set(mIso, { t: Date.now(), p }); }
                    const r = await p;
                    if (r.status !== 200) continue;
                    const entries = [];
                    (function walk(node, depth) {
                        if (!node || depth > 5) return;
                        if (Array.isArray(node)) { for (const x of node) walk(x, depth + 1); return; }
                        if (typeof node !== 'object') return;
                        if (node.date && node.timeEntryId) { entries.push(node); return; }
                        for (const val of Object.values(node)) if (val && typeof val === 'object') walk(val, depth + 1);
                    })(r.json, 0);
                    for (const e of entries) {
                        const pid = e.project && (e.project.id || e.project.projectId);
                        if (pid && e.date && String(e.date) > (projLast.get(String(pid)) || '')) projLast.set(String(pid), String(e.date));
                        const cid = e.category && e.category.categoryId;
                        const tid = e.task && (e.task.taskId || e.task.id);
                        if (!pid || !cid || !tid) continue;
                        const key = pid + '|' + cid;
                        let byTask = counts.get(key); if (!byTask) counts.set(key, byTask = new Map());
                        const rec = byTask.get(String(tid)) || { n: 0, last: '' };
                        rec.n++; if (String(e.date) > rec.last) rec.last = String(e.date);
                        byTask.set(String(tid), rec);
                    }
                } catch (err) { /* a missing week only weakens the prior — never block booking */ }
            }
            for (const [key, byTask] of counts) {
                out.set(key, [...byTask.entries()]
                    .sort((a, b) => (b[1].n - a[1].n) || b[1].last.localeCompare(a[1].last)) // modal, then most recent
                    .map(x => x[0]));
            }
            out.projLast = projLast;
            LOG('book: task prior built over', PRIOR_WEEKS, 'weeks —', out.size, 'project+category pairs,', projLast.size, 'projects booked');
            return out;
        })();
        return _priorPromise;
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
        const ACT_WORDS = { pma_local: 'phpMyAdmin', sys_tools: 'topology', start_vnc: 'VNC', restart_plant_server: 'restarts', upload: 'backup', ak3_setup: 'AK3', client_admin: 'client admin', file_upload: 'file upload', direct_plant: 'direct login', designer4: 'Designer', designer3: 'Designer', get_status: 'status check',
            // All logs activity (v4.110)
            changed_alarm_settings: 'alarm settings', change_duty_list: 'duty list', service: 'service logon', pang_note: 'note', call_plant_link: 'alarm call' };
        // What the operations log / handover notes said about this plant that day. Masked on capture —
        // and RE-masked here (v4.115), because a day cached before a secret-pattern widening still
        // carries the raw comment in full_scan_cache and must never reach a timesheet note.
        const maskedNotes = [...new Set((v.all_logs_notes || []).map(maskAllLogsComment).filter(Boolean))];
        out.notesLogs = formatAllLogsNotes(maskedNotes);
        // …and the same text as matcher evidence (v4.112). This is the one source that describes the work
        // in Thomas's own words ("Byttet føler i kjøledisk 3" ⇒ refrigeration) rather than by its
        // side-effects in the database, and it is the ONLY evidence on a day that left no config commit.
        // Set before the no-commit early return below, so those days keep it.
        out.logStr = maskedNotes.join(' ').toLowerCase();
        const ac = v.action_counts || {};
        const actEntries = Object.entries(ac).filter(([a]) => ACT_WORDS[a]).sort((x, y) => y[1] - x[1]);
        out.actionsWork = actEntries.filter(([a]) => !/^(direct_plant|designer|get_status)/.test(a)).slice(0, 3).map(([a]) => ACT_WORDS[a]).join(' + ');
        // Notes fallback when no config commit exists: the session described by its TOOLS + counts —
        // "Worked via phpMyAdmin ×3 · VNC · topology ×2" beats an empty Notes field.
        out.notesActions = actEntries.length
            ? 'Worked via ' + actEntries.slice(0, 5).map(([a, n]) => ACT_WORDS[a] + (n > 1 ? ` ×${n}` : '')).join(' · ')
            : '';
        // Same facts as a sentence — the lead line when the day left no config commit to describe.
        out.tools = actEntries.map(([a, n]) => ({ label: ACT_WORDS[a], count: n }));
        out.sumActions = summarizeActions(out.tools);
        if (v.designer_last && v.designer_last.s) out.designerSession = 'Designer session'; // no timestamps — the entry carries its own date/duration
        // Texts read the visit-window commits PLUS the rest of the day's triggered commits — the save
        // that describes your work often lands after the visit window (e.g. during the next plant).
        const seen = new Set(); const commits = [];
        for (const c of [...(v.window_commits || []), ...(v.day_commits || [])]) { const id = String(c.id); if (!seen.has(id)) { seen.add(id); commits.push(c); } }
        commits.sort((a, b) => tsFromPangDate(a.date) - tsFromPangDate(b.date));
        const newest = commits.slice(-BOOK_MAX_COMMITS);
        if (!newest.length) {
            out.notesDraw = out.designerSession || '';
            if (out.designerSession) out.sumDraw = 'Worked in the Designer on the plant\'s drawings.';
            // No commit to describe — the leader still gets a plain line (v4.131), and the disciplines
            // can only come from the day's own note here.
            const wl = bookDiscWeights(out.logStr || '', true);
            out.discs = Object.keys(wl).sort((a, b) => wl[b] - wl[a]);
            out.leadActions = summarizeLeadActions(out.tools, false);
            return out;
        }
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
        const SECRET_RE = ALL_LOGS_SECRET_RE;                 // never print secret VALUES in a timesheet note
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
                    // Structured form, so the summary sentence can phrase what happened instead of
                    // re-parsing the rendered line.
                    out.panelInfo = [...panels.entries()].map(([panel, p]) => ({ panel, added: !!p.added, from: p.from, to: p.to, what: [...p.what] }));
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
        // The same facts as one sentence, for the top of the note.
        out.sumInteg = summarizeIntegration({ uAdd, uAddNames, devAdd, uRen, renPairs, uDel, devMod: [...devMod], virtVals, settNames });
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
        // …and the drawing work as a sentence.
        out.sumDraw = summarizeDrawing(out.panelInfo, out.drawingNames, !!out.designerSession);
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
        out.hints = [out.tokStr, out.logStr, out.uStr, settNames.join(' '), out.drawingNames.join(' ')].join(' ').toLowerCase(); // for the LOG
        // The day's dominant disciplines, best first — device-table evidence plus the day's own note —
        // so the leader-facing summary can say "refrigeration controller" instead of "unit" (v4.114).
        const discSum = {};
        for (const w of [bookDiscWeights(out.tokStr || ''), bookDiscWeights(out.logStr || '', true)]) {
            for (const k in w) discSum[k] = (discSum[k] || 0) + w[k];
        }
        out.discs = Object.keys(discSum).sort((a, b) => discSum[b] - discSum[a]);
        // Leader-facing opening lines (v4.114): the plain-language first line of the entry's note.
        // The technical sentence (sumInteg / sumDraw) moves down into the detail block as evidence.
        const tuneLabels = [].concat(...[...tuneMap.values()]);
        out.leadInteg = summarizeLeadIntegration({ uAdd, uAddNames, devAdd, uRen, renPairs, uDel, devMod: [...devMod], virtVals, settNames, tuneLabels }, out.discs);
        out.leadDraw = summarizeLeadDrawing(out.panelInfo, out.drawingNames, out.discs);
        out.leadActions = summarizeLeadActions(out.tools, true); // commits existed; used only when nothing above could be said
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
        if (r.status !== 200) throw new Error(`Could not read project tasks (HTTP ${r.status}). Retry the preview.`);
        let arr = r.json;
        if (arr && !Array.isArray(arr)) arr = arr.tasks || arr.data;
        if (!Array.isArray(arr)) throw new Error('Could not read project tasks: unexpected response. Retry the preview.');
        const tasks = arr.filter(t => t && t.taskId && t.taskName && !t.deleted && !t.archived)
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
    // The task matcher lives in RL_RECAP_MATCH, above the IIFE — pure, and unit-tested by
    // task-match.test.js. It is the most heuristic code in the script; keep it measurable.

    // Build the day's booking plan: one entry per plant×category (quick checks excluded), with the
    // project resolved by plant-id prefix and the activity text derived from what actually changed.
    // onStep (optional) reports per-plant progress — the what-changed fetches are the slow part on a
    // busy pang, and a silent 5-minute "Loading…" reads as a hang (v4.103, seen live post-full-scan).
    // Calendar rows → plan entries (v4.117). They carry no project: the tenant has no meetings
    // project, so these book against the project the user picks once (KEY_CAL_PROJECT, offered in
    // the review UI like the team-bucket picker). Dedupe is by category + activity name on the date,
    // so re-running a day can never double-book a meeting.
    function calPlanEntries(calRows, cats, existing) {
        const out = [];
        const projectId = GM_getValue(KEY_CAL_PROJECT, 0) || null;
        const projectName = GM_getValue(KEY_CAL_PROJECT_NAME, '') || null;
        for (const r of (calRows || [])) {
            // The line Rocketlane shows leads with the FULL range, not just the start (v4.124):
            // "09:00–10:00 Ukesmøte" reads as the meeting it came from.
            const act = `${r.ev.allDay ? '' : calClock(r.ev.startTs) + '–' + calClock(r.ev.endTs) + ' '}${r.ev.subject}`.trim();
            // Entries booked before v4.124 carry only the start time ("09:00 Ukesmøte"). Match those too,
            // or a re-run of an already-booked day would read them as new and book the meeting twice.
            const actLegacy = `${r.ev.allDay ? '' : calClock(r.ev.startTs) + ' '}${r.ev.subject}`.trim();
            const catId = cats[r.category] || null;
            const dupe = !!catId && (existing || []).some(e => {
                if (!(e.category && e.category.categoryId === catId)) return false;
                const name = String(e.activityName || '').trim();
                return name === act || name === actLegacy;
            });
            out.push({
                calendar: true,
                plant_id: null, plant: r.ev.allDay ? 'All day' : `${calClock(r.ev.startTs)}–${calClock(r.ev.endTs)}`,
                projectId, projectName,
                taskId: null, taskName: null, taskGuess: false,
                category: r.category, categoryId: catId, minutes: r.minutes,
                activityName: act, notes: calEntryNote(r.ev, r.minutes),
                status: dupe ? 'already-booked' : !catId ? 'no-category' : !projectId ? 'no-project' : 'ready',
            });
        }
        return out;
    }

    async function buildBookingPlan(visits, iso, onStep) {
        let projects = await rlProjects(false);
        const cats = await rlCategories(), existing = await rlEntriesOn(iso);
        // Built once per session and only used to break evidence ties (v4.113). A failure here must never
        // block a booking, so it resolves to an empty Map rather than throwing.
        const taskPrior = await rlTaskPrior().catch(() => new Map());
        const plan = [];
        for (let vi = 0; vi < visits.length; vi++) {
            const v = visits[vi];
            onStep && onStep(vi + 1, visits.length, v);
            const split = categorizeVisit(v);
            const bookable = Object.entries(split).filter(([c, m]) => !CAT_NOT_BOOKED.has(c) && Math.round(m) >= 1);
            if (!bookable.length) continue;
            const pins = GM_getValue(KEY_PROJECT_PICK, {}) || {};
            const pinOpts = { pinned: pins[String(v.plant_id)] || null };
            let match = findProjectForPlant(projects, v.plant_id, taskPrior.projLast, pinOpts);
            // A plant with no project may simply be newer than the daily project cache (8949 was booked
            // into the bucket while "8949 - Prix Selje: MQTT aftermarked" existed). Refresh the inventory
            // once per session on the first miss and look again (v4.133).
            if (!match.project && !_projectsRefreshedThisSession) {
                _projectsRefreshedThisSession = true;
                try { projects = await rlProjects(true); match = findProjectForPlant(projects, v.plant_id, taskPrior.projLast, pinOpts); } catch (e) { /* keep the cached list */ }
            }
            // Twins without a pin: read each candidate's task count (session-cached) and decide again
            // with them — a real plan beats a seeded shell, whatever history says (v4.134).
            let twinCounts = null;
            if (match.candidates.length > 1 && match.reason !== 'pinned') {
                twinCounts = new Map();
                for (const c of match.candidates) { try { twinCounts.set(String(c.id), (await rlTasks(c.id)).length); } catch (e) { /* unknown stays unknown */ } }
                match = findProjectForPlant(projects, v.plant_id, taskPrior.projLast, Object.assign({ taskCount: twinCounts }, pinOpts));
            }
            const proj = match.project;
            if (proj && (match.tier > 1 || match.candidates.length > 1)) {
                LOG('book: project for', v.plant_id, '→', proj.name, '(tier', match.tier + (match.candidates.length > 1 ? `, ${match.candidates.length} share the number, chose by ${match.reason}` : '') + ')');
            }
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
                else act = CAT_SHORT[cat] + ': ' + (texts.actionsWork ? texts.actionsWork + ' follow-up' : 'follow-up and status check');
                // RAC ⇒ the "integration" is really gateway setup: move it to Setup - PC / Gateway.
                const racRedirect = (texts.racHit || racProject) && cat === CAT_INTEGRATION; // Setup reached via RAC, not via AK3
                if ((texts.racHit || racProject) && cat === CAT_INTEGRATION) {
                    category = CAT_SETUP_PC;
                    act = 'Setup: RAC' + (texts.integration ? ' — ' + texts.integration : ' setup');
                }
                // Prefer an existing project task; the rich text then rides along as the entry's note.
                // The matcher takes a category KIND, not Rocketlane's category name — see RL_RECAP_MATCH.
                const kind = category === CAT_DRAWING ? 'drawing' : category === CAT_SETUP_PC ? 'setup'
                    : category === CAT_INTEGRATION ? 'integration'
                    : category === CAT_SUPPORT ? 'support' : null;
                const catIdEarly = cats[category];
                const priorList = (proj && catIdEarly && taskPrior.get(proj.id + '|' + catIdEarly)) || null;
                const task = kind ? pickTask(tasks, kind, texts, usedTasks, priorList) : null;
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
                // The entry's Notes field, in three parts (v4.111, restructured v4.114): the FIRST
                // line is the only one Rocketlane shows collapsed and its reader is usually the
                // project LEADER — so it is the plain-language summary of what happened to the plant.
                // The technical sentence moves to the top of the detail block as evidence, then the
                // log lines, then the precise diff.
                // Two readers, two blocks (v4.131): `summary` is the leader's plain line, `tech` the
                // engineer's sentence, `details` the diff. A day with no describable change still gets a
                // plain line (leadActions) instead of falling straight to the tools sentence.
                let summary, tech, details;
                if (category === CAT_DRAWING) {
                    summary = texts.leadDraw || texts.leadActions || texts.sumDraw || '';
                    tech = texts.sumDraw || texts.sumActions || '';
                    details = texts.notesDraw || '';
                } else if (category === CAT_SETUP_PC) {
                    // Setup is reached two ways: an AK3 scanner day, or an integration day on a RAC
                    // plant that belongs under gateway setup. Say which — the old note always claimed AK3.
                    summary = summarizeLeadSetup(racRedirect);
                    tech = texts.sumInteg || texts.sumActions || '';
                    details = texts.notesInteg || '';
                } else if (category === CAT_INTEGRATION) {
                    summary = texts.leadInteg || texts.leadActions || texts.sumInteg || '';
                    tech = texts.sumInteg || texts.sumActions || '';
                    details = texts.notesInteg || '';
                } else {
                    // Support - External: a follow-up session that left no config evidence — say so in
                    // service terms; the tools sentence stays as the technical detail.
                    summary = summarizeLeadSupport(texts.tools);
                    tech = texts.sumActions || '';
                    details = texts.notesInteg || '';
                }
                if (tech === summary) tech = ''; // the summary had to fall back to the technical line — do not print it twice
                // Whatever you wrote in the operations log / a handover note that day says more about the
                // work than any diff can (already masked; secret values never travel); it joins the
                // leader's block as "Site note:".
                const notes = composeEntryNote(summary, String(texts.notesLogs || '').split('\n'), details, tech);
                plan.push({
                    plant_id: v.plant_id, plant: v.name || v.plant_id,
                    projectId: proj ? proj.id : null, projectName: proj ? proj.name : null,
                    projMatch: proj ? { tier: match.tier, n: match.candidates.length, reason: match.reason, // how the project was found (v4.133/4.134)
                        twins: match.candidates.length > 1 ? match.candidates.map(c => ({ id: c.id, name: c.name, tasks: twinCounts ? twinCounts.get(String(c.id)) : null })) : null } : null,
                    taskId: task ? task.taskId : null, taskName: task ? task.taskName : null, taskGuess: !!(task && task.rescued),
                    category, categoryId: catId || null, minutes: Math.round(min), activityName: act, notes,
                    status: !proj ? (bucketDupe ? 'already-booked' : 'no-project') : !catId ? 'no-category' : dupe ? 'already-booked' : 'ready',
                });
            }
        }
        // Calendar entries (v4.117) lead the plan — they are booked at their real duration and the
        // plant rows were already distributed over what the workday had left.
        const calRows = calPlanEntries((visits && visits._calendar) || [], cats, existing);
        if (calRows.length) plan.unshift(...calRows);
        plan._dedupeOk = existing._checkOk !== false; // surfaced as a warning banner when the check failed
        plan._existing = existing;                    // for fallback-booking dupe checks at book time
        // Team bucket projects ("Team Kulde Oppgaver", …) — offered as a fallback home for plants that
        // have no Rocketlane project of their own.
        plan._teamProjects = projects.filter(p => /^\s*team\s/i.test(p.name));

        // ---- Land the day on the workday total (v4.130) -------------------------------------------
        // Until now the plant distribution filled a whole 7,5 h regardless of what the sheet already
        // held, so a day with manual entries on it finished ABOVE the target (measured live: 7,83 h and
        // 7,92 h). Two things were missing: hours already booked never entered the budget, and the
        // distribution ran in loadDayForBooking, before anything knew which rows were ⏭ duplicates — so
        // the pot was also spread across rows that would never be booked, which pulled the day under.
        // Both are settled here, where the plan finally knows the status of every row.
        const wdMin = Math.round((GM_getValue(KEY_WORKDAY_HOURS, DEFAULT_WORKDAY_HOURS) || DEFAULT_WORKDAY_HOURS) * 60);
        const existingMin = existing.reduce((s, e) => s + (Number(e && e.minutes) > 0 ? Number(e.minutes) : 0), 0);
        const readyCalMin = plan.reduce((s, e) => s + (e.calendar && e.status === 'ready' ? (e.minutes || 0) : 0), 0);
        const budget = RL_RECAP_TIME.dayBudget({ workdayMin: wdMin, existingMin, calendarMin: readyCalMin });
        // Only the rows that will actually be booked share the remainder. A ⏭ row's minutes are already
        // counted in `existingMin`; giving it a slice again would book the same time twice over.
        const readyPlant = plan.filter(e => !e.calendar && e.status === 'ready');
        // Distribute only when this day IS being distributed. `normalized_minutes` is set by
        // normalizeMinutes and is the existing signal for it: Book week always sets it, Book day only
        // when "Distribute to total" is ticked. Reading the GM flag directly would instead have made a
        // day-panel preference silently switch off Book week's whole reason for existing.
        const distributing = visits.some(v => v && v.normalized_minutes != null);
        if (distributing && readyPlant.length) {
            const share = RL_RECAP_TIME.allocateMinutes(readyPlant.map(e => e.minutes || 0), budget.plantMin, ROUND_TO_MIN);
            for (let i = 0; i < readyPlant.length; i++) readyPlant[i].minutes = share[i];
            // A row squeezed to zero must not be booked as a 0-minute entry — the day is already full.
            for (const e of readyPlant) if (!e.minutes) e.status = 'over-budget';
        }
        budget.plant = readyPlant.reduce((s, e) => s + (e.status === 'ready' ? (e.minutes || 0) : 0), 0);
        budget.projected = budget.existing + readyCalMin + budget.plant;
        budget.normalized = distributing;
        plan._budget = budget;
        LOG('book: budget', iso, 'workday', wdMin, 'existing', existingMin, 'cal', readyCalMin,
            'plant', budget.plant, '→ day totals', budget.projected, budget.over ? '(OVER)' : '');
        return plan;
    }

    // "Not signed in to Outlook" (v4.132): one banner for both flows, with a button that opens Outlook
    // in a foreground tab so the user can sign in themselves — the script never touches credentials.
    // Clicking it also clears the sign-in latch, so the next retry genuinely asks Outlook again.
    const OUTLOOK_SIGNIN_URL = 'https://outlook.office.com/calendar/';
    function calSigninHtml(detail) {
        return `<div class="bookplan-warn">🗓 <b>Not signed in to Outlook</b>` + (detail ? ` — ${escapeHtml(detail)}` : '') +
            `. Sign in, then retry. <button type="button" data-b="outlook" class="rl-inline-btn">Sign in to Outlook</button></div>`;
    }
    function wireOutlookSignin(root) {
        root.querySelectorAll('[data-b=outlook]').forEach(b => b.addEventListener('click', () => {
            calResetSignin();
            try { GM_openInTab(OUTLOOK_SIGNIN_URL, { active: true, setParent: true }); }
            catch { try { window.open(OUTLOOK_SIGNIN_URL, '_blank'); } catch {} }
        }));
    }

    // Two live projects carry this plant's number (v4.134): say which one was chosen and why, and let
    // the user pin the right one. The pin is remembered per plant number and beats every other rule.
    function twinHtml(e) {
        const m = e && e.projMatch; if (!m || !m.twins || m.twins.length < 2) return '';
        const why = m.reason === 'pinned' ? 'pinned by you' : m.reason === 'plan' ? 'the one with a real plan'
            : m.reason === 'history' ? 'the one you last booked' : 'first in the list — pick the right one';
        const opts = m.twins.map(t => `<option value="${escapeHtml(String(t.id))}"${String(t.id) === String(e.projectId) ? ' selected' : ''}>${escapeHtml(t.name)}${t.tasks != null ? ` (${t.tasks} tasks)` : ''}</option>`).join('');
        return ` · <b>${m.twins.length} projects share this number</b> — ${why}: <select class="bookplan-proj bookplan-twin" data-n="${escapeHtml(String(e.plant_id))}" title="Pin the right project for this plant number — remembered from now on">${opts}</select>`;
    }
    function pinTwin(plantNo, projectId) {
        const pins = GM_getValue(KEY_PROJECT_PICK, {}) || {};
        pins[String(plantNo)] = +projectId;
        GM_setValue(KEY_PROJECT_PICK, pins);
        LOG('book: pinned project', projectId, 'for plant', plantNo);
    }

    // The workday-total banner (v4.130). Both flows show the same sentence, because the question is the
    // same one: after this booking, does the day read 7,5 h? Silence means it does.
    function budgetWarnHtml(budget) {
        if (!budget || !budget.workday) return '';
        const t = m => fmtMinutes(m);
        if (budget.over) {
            return `<div class="bookplan-warn">⚠ <b>Over the workday.</b> ${t(budget.existing)} is already booked on this date` +
                (budget.calendar ? ` and the calendar adds ${t(budget.calendar)}` : '') +
                ` — ${t(budget.committed)} against a ${t(budget.workday)} day, <b>${t(budget.overBy)} too much</b>. ` +
                `No plant time is added; untick something, or fix the sheet.</div>`;
        }
        if (!budget.normalized) {
            return `<div class="bookplan-warn">🕑 “Distribute to total” is off, so these are raw estimates and the day is not ` +
                `held to ${t(budget.workday)}. ${t(budget.existing)} is already booked on this date.</div>`;
        }
        if (budget.full) {
            return `<div class="bookplan-warn">🕑 <b>The day is already full.</b> ${t(budget.committed)} of ${t(budget.workday)} ` +
                `is booked, so there is no room left for plant work.</div>`;
        }
        if (budget.projected < budget.workday) {
            return `<div class="bookplan-warn">🕑 This day will total <b>${t(budget.projected)}</b> of ${t(budget.workday)} — ` +
                `${t(budget.workday - budget.projected)} short. Nothing more was found to book; add the rest by hand.</div>`;
        }
        return ''; // lands exactly on the workday — nothing to say
    }

    async function bookPlanEntries(plan, iso, onProgress) {
        const creds = rlCreds();
        let ok = 0, fail = 0;
        for (const e of plan) {
            // A calendar row the user armed by picking a project: remember the choice and book it as
            // a plain activity (no task — Rocketlane allows a task-less entry as long as it has a
            // project and a category, verified live).
            if (e.calendar && e.status === 'no-project' && e.selected === true && e.fallbackProjectId) {
                e.projectId = e.fallbackProjectId;
                e.projectName = e.fallbackProjectName || e.projectName;
                GM_setValue(KEY_CAL_PROJECT, e.projectId);
                GM_setValue(KEY_CAL_PROJECT_NAME, e.projectName || '');
                e.status = 'ready';
            }
            // Fallback rows: a no-project plant the user chose to book into a team bucket project.
            const isFallback = !e.calendar && e.status === 'no-project' && e.selected === true && e.fallbackProjectId;
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
            // Plant work is billable; calendar time is NOT (v4.126, Thomas). A meeting, planning slot
            // or course is booked so the day accounts for itself, not to be invoiced to the customer
            // whose project hosts it — and these sit on a Team bucket, so a billable flag there would
            // put internal time on someone's invoice.
            const body = { date: iso, minutes: e.minutes, billable: !e.calendar, categoryId: e.categoryId, projectId };
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
        // The calendar (v4.121). Book WEEK gets its rows from loadDayForBooking, but Book DAY books the
        // panel's own visits array, which that function never touches — so until now the 🗓 toggle did
        // nothing here and meetings simply never appeared. Fetch them for this date, then re-distribute
        // the plant minutes over what the workday has LEFT, mirroring applyAndRender's normalize rule.
        let calError = '';
        const withCalendar = (async () => {
            if (!GM_getValue(KEY_CAL_ENABLED, false)) { visits._calendar = []; return; }
            const head = box.querySelector('.bookplan-head');
            if (head) head.textContent = '⤴ Book to timesheet — reading your Outlook calendar…';
            const hours = GM_getValue(KEY_WORKDAY_HOURS, DEFAULT_WORKDAY_HOURS) || DEFAULT_WORKDAY_HOURS;
            const workdayMin = Math.round(hours * 60);
            let rows = [];
            try {
                const res = await calRowsForDate(iso, workdayMin);
                rows = res.rows || [];
                // A silent empty calendar is indistinguishable from "no meetings that day", which is
                // exactly how this feature failed the first time. Say which it was.
                if (res.error) { const e = new Error(String(res.error)); e.calCode = res.code; throw e; }
                else if (!rows.length) calError = 'no calendar events found for this date';
            } catch (e) {
                const err = new Error('Calendar unavailable: ' + (e.message || String(e)) + '. Retry, or turn off Calendar to review plant estimates only.');
                err.calCode = e && e.calCode; // signed-out gets its own screen below (v4.132)
                throw err;
            }
            visits._calendar = rows;
            if (!rows.length) return;
            // Only re-scale when the panel is actually distributing to a total; with normalize off the
            // plant rows show their raw estimates and meetings simply book alongside them.
            const bookable = visits.filter(v => categorizeVisit(v)[CAT_CHECK] == null);
            if (bookable.length && bookable.some(v => v.normalized_minutes != null)) {
                normalizeMinutes(bookable, calRemainingWorkday(rows, workdayMin), ROUND_TO_MIN);
            }
        })();
        withCalendar.then(() => buildBookingPlan(visits, iso)).then(plan => {
            if (!plan.length) { box.innerHTML = '<div class="bookplan-head">Nothing bookable for this date.</div>' + (calError ? `<div class="bookplan-warn">🗓 Calendar: ${esc(calError)}.</div>` : '') + '<div class="bookplan-foot"><button type="button" data-b="cancel">Close</button></div>'; wire(); return; }
            const ready = plan.filter(e => e.status === 'ready');
            const teamProjects = plan._teamProjects || [];
            const rememberedFallback = GM_getValue('book_fallback_project', 0);
            const rememberedCal = GM_getValue(KEY_CAL_PROJECT, 0);
            const optsFor = (sel) => teamProjects.map(p => `<option value="${p.id}"${p.id === sel ? ' selected' : ''}>${esc(p.name)}</option>`).join('');
            const teamOpts = optsFor(rememberedFallback);
            // Bookable rows get a real CHECKBOX (ticked by default) — untick what you don't want synced.
            // No-project rows get an UNTICKED checkbox + a team-bucket picker: choose a project to book
            // the plant there as "<plant id> <plant name> - <activity>". Calendar rows (v4.117) use the
            // same mechanism with their own remembered project, since meetings have no project at all.
            const lines = plan.map((e, i) =>
                `<div class="bookplan-row" data-i="${i}">
                    <span class="bookplan-st">${e.status === 'ready' ? '<input type="checkbox" class="bookplan-cb" checked title="Untick to skip this entry">'
                        : (e.status === 'no-project' && teamOpts) ? `<input type="checkbox" class="bookplan-cb" data-fallback="1"${(e.calendar ? rememberedCal : rememberedFallback) ? '' : ' disabled'} title="Tick to book into the selected project">`
                        : e.status === 'already-booked' ? '⏭' : '⚠'}</span>
                    <span class="bookplan-txt" ${e.notes ? `title="Notes:\n${esc(e.notes)}"` : ''}><b>${e.calendar ? '🗓' : esc(String(e.plant_id))}</b> ${esc(e.plant)} · ${esc(CAT_SHORT[e.category] || e.category)} <b>${fmtMinutes(e.minutes)}</b>${e.calendar ? ' <span class="bookplan-nb">non-billable</span>' : ''}<br>
                    <small>${e.taskName ? '📌 task' + (e.taskGuess ? ' <i>(best guess)</i>' : '') + ': <b>' + esc(e.taskName) + '</b> · note: ' + esc(e.activityName) : '✳ new activity: ' + esc(e.activityName)}${e.projectName ? ' → ' + esc(e.projectName) : ''}${e.projMatch && e.projMatch.tier > 1 ? ' · 📎 matched by number' : ''}${twinHtml(e)}${e.status === 'already-booked' ? ' — already booked (skipped)' : e.status === 'no-category' ? ' — category missing in Rocketlane' : e.status === 'over-budget' ? ' — no room left in the workday (skipped)' : ''}</small>${e.status === 'no-project' ? (teamOpts ? `<br><small>${e.calendar ? 'meetings need a project — book into' : 'no own project — book into'}: <select class="bookplan-proj"><option value="">choose ${e.calendar ? '' : 'team '}project…</option>${e.calendar ? optsFor(rememberedCal) : teamOpts}</select></small>` : '<br><small>— no matching project, book manually</small>') : ''}</span>
                </div>`).join('');
            const warn = (plan._dedupeOk === false ? '<div class="bookplan-warn">⚠ Couldn\'t check what\'s already booked on this date — entries may duplicate. Check the sheet before booking.</div>' : '')
                + (calError ? `<div class="bookplan-warn">🗓 Calendar: ${esc(calError)}.</div>` : '')
                + budgetWarnHtml(plan._budget);
            box.innerHTML = `<div class="bookplan-head">⤴ Book ${isoToNorwegianDate(iso)} — ${ready.length} entr${ready.length === 1 ? 'y' : 'ies'} to create</div>${warn}${lines}
                <div class="bookplan-foot"><button type="button" data-b="go" ${ready.length ? '' : 'disabled'}>Book ${ready.length} entr${ready.length === 1 ? 'y' : 'ies'}</button><button type="button" data-b="cancel">Cancel</button></div>`;
            wire();
            // Preview is read-only. Task descriptions are updated only by the explicit booking action.
            function wire() {
                const updateGo = () => {
                    const n = [...box.querySelectorAll('.bookplan-cb')].filter(c => c.checked).length;
                    const go = box.querySelector('[data-b=go]');
                    if (go) { go.disabled = n === 0; go.textContent = `Book ${n} entr${n === 1 ? 'y' : 'ies'}`; }
                };
                box.querySelectorAll('.bookplan-cb').forEach(cb => cb.addEventListener('change', updateGo));
                // Team-bucket picker: choosing a project arms + ticks the row; clearing it disarms.
                box.querySelectorAll('.bookplan-twin').forEach(sel => sel.addEventListener('change', (ev) => {
                    pinTwin(ev.target.dataset.n, ev.target.value);
                    openBookingFlow(container, visits, iso); // rebuild: task pick, dupes and budget all follow the project
                }));
                box.querySelectorAll('.bookplan-proj:not(.bookplan-twin)').forEach(sel => sel.addEventListener('change', (ev) => {
                    const row = ev.target.closest('.bookplan-row');
                    const cb = row && row.querySelector('.bookplan-cb');
                    const val = +ev.target.value || 0;
                    if (cb) { cb.disabled = !val; cb.checked = !!val; }
                    // Remember per KIND — see the Book week handler: a meeting's team project and the
                    // no-project-plant fallback are separate choices over the same list.
                    const isCal = !!(row && plan[+row.dataset.i] && plan[+row.dataset.i].calendar);
                    if (val) {
                        GM_setValue(isCal ? KEY_CAL_PROJECT : 'book_fallback_project', val);
                        if (isCal) GM_setValue(KEY_CAL_PROJECT_NAME, ev.target.options[ev.target.selectedIndex].text);
                    }
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
            const signin = calNeedsSignin(err && err.calCode);
            box.innerHTML = signin
                ? `<div class="bookplan-head">Couldn't read your calendar</div>` + calSigninHtml(String(err && err.message || '').replace(/^Calendar unavailable: /, '').replace(/\. Retry.*$/, '')) +
                  `<div class="bookplan-foot"><button type="button" data-b="cancel">Close</button></div>`
                : `<div class="bookplan-head">Couldn't build the plan: ${esc(String(err && err.message || err))}</div><div class="bookplan-foot"><button type="button" data-b="cancel">Close</button></div>`;
            wireOutlookSignin(box);
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
    async function weekEnsureFullScan(mondayIso, statusCb, force) {
        const username = effectiveUsername();
        if (!username) return { ok: false, reason: 'pang user unknown — open pang once' };
        const today = todayISO();
        const need = [];
        for (let i = 0; i < 5; i++) {
            const iso = addDaysISO(mondayIso, i);
            if (iso > today) continue; // future — nothing to scan
            const c = readCache(username, iso);
            // `force` (v4.116, the pre-build check-up): the user asked for a fresh sweep, so every
            // weekday is re-verified regardless of cache — a day cached by a quick Refresh passes the
            // cache test here yet can hide plant-admin/designer visits. All logs still answers first.
            if (force || !c || (iso === today && Date.now() - (c.scanned_at || 0) > WEEK_TODAY_MAX_AGE_MS)) need.push(iso);
        }
        if (!need.length) return { ok: true, ran: false };
        // A complete All logs reply covers the whole fleet for that day, which is exactly the guarantee
        // this gate exists to provide — so a day it answers needs no full scan. loadDayForBooking queries
        // All logs again per day (session-cached), so nothing is stored here.
        // NOT on a forced sweep (v4.118): ↻ Refresh and 🔍 Full scan first mean "re-scan pang", and this
        // shortcut would silently skip that. Only the pang path rewrites the day cache (the All logs path
        // stores nothing), so skipping it left cached weekdays stale. Automatic builds keep the shortcut.
        if (!force) {
            statusCb && statusCb(`Checking IWMAC All logs for ${need.length} day${need.length === 1 ? '' : 's'}…`);
            const stillNeed = [];
            for (const iso of need) {
                const al = await gmFetchAllLogs(iso, username);
                if (!(al.ok && !al.limit_reached)) stillNeed.push(iso);
            }
            if (!stillNeed.length) {
                markFullScanRan(); // every weekday was covered fleet-wide — the daily recommendation is satisfied
                return { ok: true, ran: false, from_all_logs: true };
            }
            need.length = 0;
            need.push(...stillNeed);
        }
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
        markFullScanRan(); // Book week swept every plant too — the panel must not recommend it again today (v4.109)
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
        // One All logs request beats every other source for a single day: whole fleet, no staleness,
        // and it carries the notes / operations-log entries the timesheet notes want. Truncated or
        // unreachable → fall back, but still overlay whatever it returned.
        statusCb && statusCb('querying IWMAC All logs…');
        const al = await tryLoadVisitsFromAllLogs(iso);
        if (al && !al.limit_reached) {
            visits = al.visits;
        } else if (overrideDates) {
            visits = (overrideDates[iso] || []).map(v => ({ ...v })); // fresh full scan that couldn't be cached (partial)
            if (al && al.visits.length) visits = overlayAllLogsOntoStampedVisits(visits, al.visits);
        } else if (cached) {
            visits = cached.visits.map(v => ({ ...v }));
            if (al && al.visits.length) visits = overlayAllLogsOntoStampedVisits(visits, al.visits);
        } else {
            const recent = (GM_getValue(KEY_KNOWN_PLANTS, []) || []).map(String);
            const mine = ((GM_getValue(KEY_USER_PLANTS, {})[username]) || []).map(String);
            const plantIds = [...new Set([...recent, ...mine])];
            if (!plantIds.length) visits = al ? al.visits : [];
            else {
                const merging = !!al;
                const r = await loadVisitsForDate(iso, plantIds, onProg, { keepEvents: merging });
                visits = merging ? stampVisitTime(overlayAllLogsVisits(r.visits, al.visits)) : (r.visits || []);
            }
        }
        // Meetings first, plant work fills the rest (v4.117, Thomas's rule): calendar time is booked
        // at its real duration and the plant distribution gets only what is left of the workday.
        // Read BEFORE the no-plant-work return (v4.125): a day of nothing but meetings — a course, a
        // day of workshops — used to leave here with no _calendar at all, so Book week booked nothing
        // for it while Book day, which reads the calendar on its own, booked it fine.
        const hours = GM_getValue(KEY_WORKDAY_HOURS, DEFAULT_WORKDAY_HOURS) || DEFAULT_WORKDAY_HOURS;
        const workdayMin = Math.round(hours * 60);
        let calRows = [];
        if (GM_getValue(KEY_CAL_ENABLED, false)) {
            statusCb && statusCb('reading your Outlook calendar…');
            const calendarResult = await calRowsForDate(iso, workdayMin);
            if (calendarResult.error) { const e = new Error('Calendar unavailable: ' + calendarResult.error + '. Retry this day.'); e.calCode = calendarResult.code; throw e; }
            calRows = calendarResult.rows || [];
        }
        visits._calendar = calRows;
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
        const bookable = visits.filter(v => categorizeVisit(v)[CAT_CHECK] == null);
        if (bookable.length) normalizeMinutes(bookable, calRemainingWorkday(calRows, workdayMin), ROUND_TO_MIN);
        return visits;
    }
    // ↻ Refresh (v4.117): make the NEXT build a genuine re-read instead of a replay. Three session
    // caches would otherwise survive even a forced full scan and hand back the same answers: All logs
    // per (user|date), commits per plant (10 min), and the Rocketlane weekly entries that decide
    // ready vs ⏭ already-booked (60 s). Drop them for this week, and clear the All-logs outage latch
    // so a refresh after a blip actually retries instead of failing fast.
    function weekForgetCached(mondayIso) {
        const week = new Set();
        for (let i = 0; i < 5; i++) week.add(addDaysISO(mondayIso, i));
        for (const k of [..._allLogsCache.keys()]) {
            if (week.has(k.slice(k.indexOf('|') + 1))) _allLogsCache.delete(k);
        }
        _allLogsDownUntil = 0;
        _commitsCache.clear();
        _rlWeekCache.clear();
        calResetSignin(); // ↻ after signing in must ask Outlook again (v4.132)
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
        // Full-scan check-up state (v4.116): asked once per modal; a forced sweep applies to the
        // next build only (it caches every date it finds, so week navigation needs no repeat).
        let scanChoice = null, forceScanOnce = false;
        let calChoice = null; // null = the calendar question is still pending for this modal (v4.129)

        // 🗓 toggle in the week head (v4.128, Thomas's ask). Book week has booked calendar rows since
        // v4.125 and loadDayForBooking reads them — but the ONLY control for KEY_CAL_ENABLED lived on the
        // Plants-visited panel, and it defaults to OFF. Book week opens standalone from the toolbar
        // button, so unless he happened to have ticked that box in the other panel, the week silently
        // booked no meetings and offered no way to notice or change it. Same key, so the two stay in step.
        const headHtml = () => `<div class="bookplan-head">⤴ Book week ${isoToNorwegianDate(monday)} – ${isoToNorwegianDate(addDaysISO(monday, 4))}
            <span class="rl-week-nav"><label class="rl-week-cal" title="Read your Outlook calendar for every weekday in this week and offer meetings, planning and training as timesheet entries. Meetings book at their real length FIRST; each day's plant distribution then splits whatever the workday has left. Same setting as the panel's 🗓 Include calendar."><input type="checkbox" data-b="cal"${GM_getValue(KEY_CAL_ENABLED, false) ? ' checked' : ''}> 🗓</label><button type="button" data-b="refresh" title="Refresh — run a new full scan for this week (~1 min) and rebuild, ignoring cached data">↻</button><button type="button" data-b="prev" title="Previous week">‹</button><button type="button" data-b="next" title="Next week">›</button><button type="button" data-b="cancel" title="Close">✕</button></span></div>`;
        const wireNav = () => {
            // ↻ rebuilds this week from scratch: forget the session answers, then force the same sweep
            // the pre-build check-up offers — available in every state (check-up, building, results),
            // and reachable even once a full scan has already run today (when no check-up appears).
            box.querySelector('[data-b=refresh]')?.addEventListener('click', () => {
                weekForgetCached(monday);
                scanChoice = 'scan'; forceScanOnce = true;
                build();
            });
            // Toggling rebuilds: the calendar is read per day inside loadDayForBooking, and turning it on
            // also changes how each day's plant minutes are distributed (meetings take their real length
            // off the workday first), so the existing plans cannot just be re-rendered.
            box.querySelector('[data-b=cal]')?.addEventListener('change', (ev) => {
                const on = !!ev.target.checked;
                GM_setValue(KEY_CAL_ENABLED, on);
                if (!on) _calCache.clear(); // same rule as the panel toggle: off drops the cache, so on re-asks Outlook
                calResetSignin();
                const chk = document.querySelector(`#${PANEL_ID} input[data-field="calendar"]`); // keep the panel in step
                if (chk) chk.checked = on;
                build();
            });
            box.querySelector('[data-b=prev]')?.addEventListener('click', () => { monday = addDaysISO(monday, -7); build(); });
            box.querySelector('[data-b=next]')?.addEventListener('click', () => { monday = addDaysISO(monday, 7); build(); });
            box.querySelectorAll('[data-b=cancel]').forEach(b => b.addEventListener('click', () => wrap.remove()));
            wireOutlookSignin(box);
        };

        // Pre-build check-up. Two questions, ONE screen (v4.129) — asking them in sequence would mean two
        // modals before a week ever builds.
        //
        // Full scan (v4.116, Thomas's ask): the v4.101 cache gate below trusts any cached weekday —
        // including one written by a quick Refresh, which can hide plant-admin/designer visits — so when
        // no scan has run today the trust has to be his call, not silent.
        //
        // Calendar (v4.129, Thomas's ask: "it should give a prompt when you book week if you want to sync
        // calendar"): 4.128 put a 🗓 toggle in the head, but a toggle you have to notice is not the same as
        // being asked, and the setting defaults to OFF — so a week could still be booked without meetings
        // simply because nobody thought about it. Asked once per DAY (KEY_CAL_ASKED), the same anti-nag
        // rule the full-scan recommendation uses, because reopening Book week twice in an hour should not
        // re-ask. The checkbox writes through immediately, so the head toggle and this never disagree.
        function renderCheckup(askScan, askCal) {
            const calOn = GM_getValue(KEY_CAL_ENABLED, false);
            let body = '';
            if (askScan) {
                body += `<div class="rl-week-status">🔍 Check-up: <b>no full scan has run today.</b><br>` +
                    `<small>Cached weekdays may date from before today's work or come from a quick Refresh, which can miss ` +
                    `plant-admin/designer visits. A fresh sweep (~1 min) re-scans every plant and rewrites the cache for ` +
                    `every weekday at once.</small></div>`;
            }
            if (askCal) {
                body += `<div class="rl-week-status">🗓 <b>Sync your Outlook calendar for this week?</b><br>` +
                    `<label class="rl-week-calask"><input type="checkbox" data-b="calask"${calOn ? ' checked' : ''}> ` +
                    `Include meetings, planning and courses</label>` +
                    `<small>Each weekday's events are booked at their real length first, and the plant estimates then split ` +
                    `whatever the workday has left. If Outlook is already open in a tab it is read there; otherwise a ` +
                    `background tab opens for a few seconds and closes itself. Asked once a day — the 🗓 box above changes ` +
                    `it any time.</small></div>`;
            }
            const foot = askScan
                ? `<button type="button" data-b="scanfirst">🔍 Full scan first</button><button type="button" data-b="cached">Use cached data</button>`
                : `<button type="button" data-b="go">Build the week</button>`;
            box.innerHTML = headHtml() + body + `<div class="bookplan-foot">${foot}</div>`;
            wireNav();
            // Write through on change rather than on continue: the head toggle reads the same key, and a
            // checkbox that only takes effect when you press a button is exactly the kind of thing that
            // leaves the two disagreeing.
            box.querySelector('[data-b=calask]')?.addEventListener('change', (ev) => {
                const on = !!ev.target.checked;
                GM_setValue(KEY_CAL_ENABLED, on);
                if (!on) _calCache.clear();
                const head = box.querySelector('input[data-b=cal]');
                if (head) head.checked = on;
                const panel = document.querySelector(`#${PANEL_ID} input[data-field="calendar"]`);
                if (panel) panel.checked = on;
            });
            const answered = () => { if (askCal) { GM_setValue(KEY_CAL_ASKED, todayISO()); calChoice = 'asked'; } };
            box.querySelector('[data-b=scanfirst]')?.addEventListener('click', () => { answered(); scanChoice = 'scan'; forceScanOnce = true; build(); });
            box.querySelector('[data-b=cached]')?.addEventListener('click', () => { answered(); scanChoice = 'cached'; build(); });
            box.querySelector('[data-b=go]')?.addEventListener('click', () => { answered(); build(); });
        }

        async function build() {
            const { askScan, askCal } = weekCheckupPlan({
                fullScanRanToday: fullScanRanToday(), scanChoice, calChoice,
                calAskedDate: GM_getValue(KEY_CAL_ASKED, ''), today: todayISO(),
            });
            if (askScan || askCal) { renderCheckup(askScan, askCal); return; }
            const force = forceScanOnce; forceScanOnce = false;
            const mySeq = ++seq;
            box.innerHTML = headHtml() + '<div class="rl-week-status">Building plans…</div>';
            wireNav();
            const statusEl = () => box.querySelector('.rl-week-status');
            // Full-scan gate (v4.101): the week's plans must come from FULL-scan data — run one scan
            // covering every uncached weekday before building. Quick data is only ever the fallback
            // when the scan itself is impossible, and then it's flagged loudly.
            let weekWarn = '', weekInfo = '', override = null;
            try {
                const fs = await weekEnsureFullScan(monday, msg => { const s = statusEl(); if (s && seq === mySeq) s.textContent = msg; }, force);
                if (seq !== mySeq) return;
                if (!fs.ok) weekWarn = `⚠ Full scan unavailable (${esc(fs.reason)}) — built from quick data, plans may MISS plants.`;
                else if (fs.ran && fs.failed) { weekWarn = `⚠ ${fs.failed} plant${fs.failed === 1 ? '' : 's'} unreachable during the full scan — using the partial result (not cached).`; override = fs.dates; }
                else if (fs.from_all_logs) weekInfo = `✓ Check-up: IWMAC All logs answered for every weekday${force ? ' — no pang sweep needed' : ''}.`;
                else if (fs.ran) weekInfo = '✓ Check-up: full scan completed for this build.';
                else if (fullScanRanToday()) weekInfo = '✓ Check-up: a full scan has already run today.';
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
                    // Meetings alone are worth a plan (v4.125): a day with no plant work but a calendar
                    // full of them used to be skipped here, so Book week silently dropped it.
                    const hasWork = visits.length || (visits._calendar && visits._calendar.length);
                    const plan = hasWork ? await buildBookingPlan(visits, iso,
                        (n, total, v) => say(`reading what changed — plant ${n} of ${total} (${v.plant_id})…`)) : [];
                    // Carry the calendar count so the row can say "no calendar events" rather than leave a
                    // silent empty calendar looking identical to a day with no meetings (v4.128) — the
                    // exact ambiguity that hid this feature's first failure, see calRowsForDate.
                    days.push({ iso, wd: WD[i], plan, cal: (visits._calendar || []).length });
                    // Building a week preview must not update task descriptions.
                } catch (err) {
                    days.push({ iso, wd: WD[i], plan: [], err: String((err && err.message) || err), calCode: err && err.calCode });
                }
            }
            if (seq !== mySeq) return;
            render(days, weekWarn, weekInfo);
        }

        function render(days, weekWarn, weekInfo) {
            const rows = []; // flat index across all days: { e, day }
            // Team-bucket picker for no-project plants — same flow as ⤴ Book day (v4.97): choose a
            // "Team … Oppgaver" project, the row arms, and it books there as "<plant id> <plant> - <activity>".
            const teamProjects = (days.find(d => d.plan && d.plan._teamProjects && d.plan._teamProjects.length) || { plan: {} }).plan._teamProjects || [];
            const rememberedFallback = GM_getValue('book_fallback_project', 0);
            const rememberedCal = GM_getValue(KEY_CAL_PROJECT, 0);
            const calOn = GM_getValue(KEY_CAL_ENABLED, false);
            const optsFor = (sel) => teamProjects.map(p => `<option value="${p.id}"${p.id === sel ? ' selected' : ''}>${esc(p.name)}</option>`).join('');
            const teamOpts = optsFor(rememberedFallback);
            let html = '';
            for (const day of days) {
                const unsafe = day.plan._dedupeOk === false; // can't see what's already booked ⇒ never book this day
                const ready = day.plan.filter(e => e.status === 'ready');
                const already = day.plan.filter(e => e.status === 'already-booked').length;
                const noCat = day.plan.filter(e => e.status === 'no-category').length;
                const mins = ready.reduce((s, e) => s + e.minutes, 0);
                // With the calendar on, a day that returned no events says so — "no plant work" alone
                // would read as "nothing happened" when it may mean the calendar was never consulted.
                const calNote = calOn && !day.err && day.cal === 0 ? ' · 🗓 no calendar events' : '';
                const side = day.err ? (calNeedsSignin(day.calCode) ? '⚠ not signed in to Outlook — day skipped' : '⚠ ' + esc(day.err))
                    : !day.plan.length ? 'no plant work' + calNote
                    : unsafe ? '⚠ can’t verify what’s booked — day skipped'
                    : `${ready.length ? `${ready.length} to book · ${fmtMinutes(mins)}` : 'nothing new'}${already ? ` · ⏭ ${already} already booked` : ''}${noCat ? ` · ⚠ ${noCat} missing category — flip ‹ › to retry` : ''}${calNote}`;
                html += `<div class="rl-week-day">${day.wd} ${isoToNorwegianDate(day.iso)} <small>${side}</small></div>`;
                if (unsafe) continue;
                html += budgetWarnHtml(day.plan._budget); // silent when the day lands on the workday total
                for (const e of day.plan) {
                    const i = rows.length;
                    rows.push({ e, day });
                    html += `<div class="bookplan-row" data-i="${i}">
                        <span class="bookplan-st">${e.status === 'ready' ? '<input type="checkbox" class="bookplan-cb" checked title="Untick to skip this entry">'
                            : (e.status === 'no-project' && teamOpts) ? `<input type="checkbox" class="bookplan-cb" data-fallback="1"${(e.calendar ? rememberedCal : rememberedFallback) ? '' : ' disabled'} title="Tick to book into the selected team project">`
                            : e.status === 'already-booked' ? '⏭' : '⚠'}</span>
                        <span class="bookplan-txt" ${e.notes ? `title="Notes:\n${esc(e.notes)}"` : ''}><b>${e.calendar ? '🗓' : esc(String(e.plant_id))}</b> ${esc(e.plant)} · ${esc(CAT_SHORT[e.category] || e.category)} <b>${fmtMinutes(e.minutes)}</b>${e.calendar ? ' <span class="bookplan-nb">non-billable</span>' : ''}<br>
                        <small>${e.taskName ? '📌 task' + (e.taskGuess ? ' <i>(best guess)</i>' : '') + ': <b>' + esc(e.taskName) + '</b>' : '✳ new activity: ' + esc(e.activityName)}${e.projMatch && e.projMatch.tier > 1 ? ' · 📎 matched by number' : ''}${twinHtml(e)}${e.status === 'already-booked' ? ' — already booked' : e.status === 'over-budget' ? ' — no room left in the workday' : ''}</small>${e.status === 'no-project' ? (teamOpts ? `<br><small>${e.calendar ? 'meetings need a project — book into' : 'no own project — book into'}: <select class="bookplan-proj"><option value="">choose team project…</option>${e.calendar ? optsFor(rememberedCal) : teamOpts}</select></small>` : '<br><small>— no matching project, book manually</small>') : ''}</span>
                    </div>`;
                }
            }
            const readyRows = rows.filter(r => r.e.status === 'ready');
            const signinDays = days.filter(d => calNeedsSignin(d.calCode)).length;
            box.innerHTML = headHtml() + (weekWarn ? `<div class="bookplan-warn">${weekWarn}</div>` : '')
                + (signinDays ? calSigninHtml(`${signinDays} of 5 days could not be read`) : '')
                + (weekInfo ? `<div class="rl-week-info">${weekInfo}</div>` : '') + html +
                `<div class="bookplan-foot"><button type="button" data-b="go" ${readyRows.length ? '' : 'disabled'}>Book ${readyRows.length} entr${readyRows.length === 1 ? 'y' : 'ies'}</button><button type="button" data-b="cancel">Close</button></div>`;
            wireNav();
            const updateGo = () => {
                const n = [...box.querySelectorAll('.bookplan-cb')].filter(c => c.checked).length;
                const go = box.querySelector('[data-b=go]');
                if (go) { go.disabled = n === 0; go.textContent = `Book ${n} entr${n === 1 ? 'y' : 'ies'}`; }
            };
            box.querySelectorAll('.bookplan-cb').forEach(cb => cb.addEventListener('change', updateGo));
            // Team-bucket picker: choosing a project arms + ticks the row; clearing it disarms (as in Book day).
            box.querySelectorAll('.bookplan-twin').forEach(sel => sel.addEventListener('change', (ev) => {
                pinTwin(ev.target.dataset.n, ev.target.value);
                build(); // rebuild the week: task pick, dupes and budget all follow the project
            }));
            box.querySelectorAll('.bookplan-proj:not(.bookplan-twin)').forEach(sel => sel.addEventListener('change', (ev) => {
                const row = ev.target.closest('.bookplan-row');
                const cb = row && row.querySelector('.bookplan-cb');
                const val = +ev.target.value || 0;
                if (cb) { cb.disabled = !val; cb.checked = !!val; }
                // Remember per KIND: a calendar row's team project must not overwrite the plant
                // fallback default (they are separate choices that happen to share one list).
                const isCal = !!(row && rows[+row.dataset.i] && rows[+row.dataset.i].e.calendar);
                if (val) {
                    GM_setValue(isCal ? KEY_CAL_PROJECT : 'book_fallback_project', val);
                    if (isCal) GM_setValue(KEY_CAL_PROJECT_NAME, ev.target.options[ev.target.selectedIndex].text);
                }
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
                    <div class="lognote">${logNoteLine(v)}</div>
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
    } else if (CAL_HOSTS.has(host)) {
        syncFromOutlook();
    } else if (host === 'kiona.rocketlane.com') {
        initRocketlane();
    }
})();
