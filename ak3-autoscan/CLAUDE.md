# AK3 Auto Scan — technical reference

Deep technical notes for this one script, so work can be resumed cold on any machine. For repo-wide
rules (version bumping, commit/push, line endings) see the **root `CLAUDE.md`**. User-facing install is
in this folder's **`README.md`** (whose "AI Reference" block is a lighter, older summary — **this file is
the authoritative *how it actually works* doc**; when they disagree, trust the source + this file).

> Single file: `ak3-autoscan/AK3-Autoscan.user.js` — one big IIFE, `@grant GM_*` + `GM_xmlhttpRequest`.
> Current version: **8.6**. Always bump `@version` + commit + push (Tampermonkey auto-updates).

---

## 1. What it is / where it runs

A Tampermonkey userscript that fully automates the **AK3 scanner setup** workflow on an IWMAC plant
server. It injects a green **▶ Auto Scan** button into the `ak3_setup` side menu; one click drives the
entire multi-tab setup end-to-end, streaming progress into a floating debug panel, and **survives page
reloads** (the server reloads the page between several steps).

- `@match http://*.plants.iwmac.local:8080/secure/ak3_setup/*` — the only page it runs on.
- `@run-at document-idle`.
- **Plant id** is parsed from the host: `location.host.match(/^(\d+)\.plants\.iwmac\.local/)`
  (`getPlantIdFromHost`). Everything is scoped to that id; a tab is bound to exactly one plant by URL.

---

## 2. Architecture: a reload-surviving state machine

The workflow is a **linear state machine** persisted in GM storage, so a full-page reload mid-run just
resumes. `runAk3Setup()` is a `while (true)` loop that **re-reads `getState()` every iteration** and
dispatches on `state.step`; each step ends by calling `setState({ plantId, step: <next> })`. Because state
lives in storage (not memory), when the server reloads the page the script re-inits, the router at the
bottom sees a live state, and the loop picks up at the saved step.

**Step order:**
```
dbcheck → ipconfig → (ipconfig_wait) → scan → default_links → copyplant → activate → (done: clearState)
```

State shape: `{ plantId, step, ts }` (`setState` stamps `ts: Date.now()`). `getState`/`setState`/
`clearState` wrap `STATE_KEY`.

- **`ipconfig_wait`** is a defensive resume branch — nothing ever *sets* the step to it; if it's ever read
  it just redirects back to `ipconfig`. Leave it in place.
- The **router** at the very bottom (lines ~811-818) does two things on every page load: shows the debug
  panel iff `getState()` is truthy and the panel wasn't manually closed, and injects the menu button iff
  there's a plant id in the host. The workflow itself only starts from the button click (or an in-progress
  state after a reload).

---

## 3. Per-plant storage scoping (multi-plant parallelism)

Tampermonkey `GM_*` storage is **shared across all tabs** running the script. To scan several plants at
once without cross-talk, every persisted key is namespaced by plant id:

| Key helper | Key | Holds |
|---|---|---|
| `stateKeyFor(pid)` | `ak3_state_<pid>` | current workflow step |
| `logKeyFor(pid)` | `ak3_log_<pid>` | debug-panel log buffer (capped **300** lines) |
| `panelClosedKeyFor(pid)` | `ak3_panel_closed_<pid>` | user dismissed the panel |

`TAB_PLANT_ID` is resolved once at load; `STATE_KEY` / `LOG_KEY` / `PANEL_CLOSED_KEY` are the
bound-to-this-tab constants. A one-time cleanup deletes the pre-7.7 **global** keys (`ak3_state`,
`ak3_log`, `ak3_panel_closed`) so they don't linger.

---

## 4. AK3 mode switching (the critical bit) — `setAk3Mode`

Before scanning, the AK3 driver is put into a fast-polling **ScannerMode**; on completion **or any
failure** it's restored to **StandardMode**. Getting this wrong leaves the plant hammering its bus.

| Mode | `packet_timeout` | `packet_interval` | When |
|---|---|---|---|
| **ScannerMode** | `100` | `400` | set on Auto-Scan start; **re-applied after `iw_ak3_scanner` is created** (§5 `dbcheck`) |
| **StandardMode** | `10` | `4000` | set after `activate`, and on **every** failure path |

Applied by a direct **SQL `UPDATE`** (single statement, `CASE` over both settings):
```sql
UPDATE `iw_plant_server3`.`iw_sys_plant_settings`
SET `value` = CASE WHEN `setting`='packet_timeout' THEN '…'
                   WHEN `setting`='packet_interval' THEN '…' ELSE `value` END,
    `row_date` = NOW()
WHERE `owner`='AK3' AND `setting` IN ('packet_timeout','packet_interval');
```
- POSTed form-encoded (`plant_id`, `sql_command`) to **`http://toolbox.iwmac.local:8505/plant-sql/`**
  via `gmPost`; expects JSON `{ success: true }` (throws otherwise).
- Then logs a `pma_local` action (JSON-RPC `log`) to
  **`http://tools.iwmac.local/services/pang/actions.php`** (`logPmaLocal`) so the visit shows up in
  pang/Day-Recap. **Non-fatal** — wrapped in try/catch; a failure is logged, not thrown.
- **Dedup:** `_pmaLocalLogged` (a `Set`) logs `pma_local` at most **once per page session** even though
  `setAk3Mode` runs twice (Scanner on start, Standard at end).

**Failure safety (do not remove):** the whole step loop is wrapped in try/catch. On any thrown error it
attempts `setAk3Mode(plantId,'StandardMode')` *before* `fail()`. If that revert also throws, it logs a
loud `WARNING: … may still be at ScannerMode values!` — the packet settings could be stuck fast.

**Request headers on both endpoints:** `X-Caller: AK3-Autoscan`, `X-Run-Id: <uuid>`. The run id is
per-plant: `ensureRunIdForPlant(pid)` regenerates `_runId` whenever the plant id changes (`makeUuid` =
`crypto.randomUUID` with a `Date.now()+Math.random()` fallback). `@connect` grants cover
`toolbox.iwmac.local`, `toolbox.iwmac.local:8505`, `tools.iwmac.local`.

---

## 5. The steps in detail

### `dbcheck`
Opens the **DB Sjekk** tab, waits for `.test-box`, reads each `.test-box p`: needs both
`iw_plant_server3 … OK` and `iw_ak3_scanner … OK`. If either is missing, clicks `button#create_scan_db`
("Lag database iw_ak3_scanner") and waits for `#message` = `"Database opprettet"`. Missing create button →
logs and continues.

> ⚠️ **If `iw_ak3_scanner` was created here, ScannerMode is re-applied right after** (`setAk3Mode(plantId,
> 'ScannerMode')`, gated on a `dbCreated` flag). Creating the scanner DB **regenerates the AK3 rows in
> `iw_sys_plant_settings`**, resetting the packet values (100/400) set at Auto-Scan start — without the
> re-apply the scan would run in StandardMode (slow polling). The re-apply is intentionally *outside* the
> "create button might be missing" try/catch, so a `setAk3Mode` failure propagates to the outer handler
> (revert to StandardMode + abort), consistent with the initial fatal ScannerMode set.

### `ipconfig` (by far the most intricate — this is where most field failures happen)
1. Opens **IP Config**, waits for `input#localIp` / `input#remoteIp`.
2. **IP source of truth = the page hints**, not the constants: `detectConfiguredIp('Server config satt
   til')` and `detectConfiguredIp('AK-SM850 config satt til')` pull an IPv4 out of the `#content h2 … <em>`
   hints (regex handles a bare IP *or* one embedded in a URL). Only if a hint has no IP does it fall back
   to `LOCAL_IP` `192.168.10.10` / `REMOTE_IP` `192.168.10.20`. Both values are written with `setInput`.
3. Enable the **HTTPS** checkbox (`input#httpsForm`), click **Test tilkobling** (`input#ipForm`).
4. `waitForSaveOrInvalid(60000)` races two outcomes: the visible **Save** button appears (`kind:'save'`)
   vs `input#remoteIp` gains the `.invalid` class (`kind:'invalid'`, a fast fail signal).
5. **HTTPS on→off fallback:** if no Save button, force HTTPS **off** (click, then hard-set
   `checked=false` + dispatch change/click) and re-click Test up to **5×** with growing waits
   (20s/25s/30s), re-racing save-or-invalid each time.
6. **Save:** `clickIpSaveUntilConfirmed(8)` clicks `#ipSave` up to **8×**, **re-querying the button every
   iteration** (it re-renders after each test), until `#message` contains `"IPer oppdatert"`. Each attempt
   fires `.click()` + jQuery `trigger('click')` **and** `form.requestSubmit()/submit()`.
7. If still unconfirmed, one more HTTPS-off → Test → 8× save-click cycle, then a last
   `waitForTextLogged('#message','IPer oppdatert')`.
8. **Total failure → manual mode:** show a yellow `#ak3-manual-banner`, `waitForText('#message','IPer
   oppdatert', {timeout: 24h})`, then a `confirm()` to continue or abort. Refreshes state ts to keep
   auto-resume valid.

> ⚠️ **Never `form.submit()` the Test tilkobling button.** It's **AJAX-only**; a real form submit triggers
> a POST/navigation that reloads the page to the start of the workflow. (There's an explicit code comment
> to this effect — the save button *is* submitted, the test button is not.)

> ⚠️ **There can be multiple `#ipSave` nodes** in the DOM (templates, hidden forms). `findVisibleIpSave`
> skips `offsetParent === null` (hidden) ones and **prefers** the one whose inline style is
> `pointer-events:auto; opacity:1` (the "ready after a successful test" state).

### `scan`
Clicks `input#scanButton` ("Scan anlegg"), then polls the **scan iframe** (`#scanWindow iframe` or
`iframe[src*="iframe/scan"]`, read cross-frame via `contentDocument`) for `#percent` text `100%` **or** a
visible `#done` containing `"Scan done"`. **Timeout: 2 hours (`7200000` ms).**

### `default_links`
Opens **Default links**, clicks `button#selectTherm` ("Sett alle til første med Therm") →
`button#save_default_links`, waits for `#message` = `"Default links oppdatert"`, then waits for the
`#content` loading text `"Vennligst vent mens default links laster"` to disappear (**1 h** timeout). Button
waits here are generous (**600000** ms / 10 min).

### `copyplant`
Opens **Kopier til anlegg**, clicks `button#copy_db` ("Kopier og overskriv ALT"), clicks a
`button.pang-confirm-ok` if a confirm dialog is present, waits for `#message` = `"Database kopiert"`.

### `activate`
Opens **Aktiver anlegg**, clicks `button#activateAllButton` ("Aktiver alle"), waits for `#message` =
`"Enheter aktivert"`, sets **StandardMode**, `clearState()`, and alerts completion.

---

## 6. DOM interaction helpers (why they're multi-strategy)

The `ak3_setup` page is jQuery-driven and some handlers ignore a plain `.click()`, so:

- **`clickEl(el, label)`** fires **all three**: `el.click()`, a synthetic `MouseEvent('click', {bubbles})`,
  and jQuery `$(el).trigger('click')`.
- **`setInput(el, value)`** sets the value via the **native property-descriptor setter** (so React/JS
  frameworks see it), then dispatches `input`/`change`/`keyup`/`blur` + the jQuery equivalents.
- **`enableButton(el)`** force-unlocks a disabled button (`disabled=false`, strips `disabled` /
  `aria-disabled` / `.disabled`, `pointer-events:auto`, `opacity:1`) — used before clicking Test/Save.
- **`clickTab(id)`** waits for `li#<id>`, clicks it, waits 400 ms.
- Poll primitives: `waitFor(sel,{timeout=30000})`, `waitForText(sel,text,{timeout=30000})`, plus the
  logging variants `sleepLogged` / `waitForTextLogged` that print elapsed time, and the IP-specific
  `waitForIpSaveButton` / `waitForSaveOrInvalid` / `isRemoteIpInvalid`.

**Debug panel** (`injectDebugPanel` / `renderDebugPanel`): fixed top-right overlay, monospace, renders the
`LOG_KEY` buffer; clear / minimise (−) / **× Close** (sets `PANEL_CLOSED_KEY`). Only shown while a scan is
in progress and not dismissed. `log()` writes to console **and** the buffer (trimmed to 300 lines) and
re-renders.

---

## 7. Gotchas (these are the real footguns)

1. **Mode revert is load-bearing.** Any early return / thrown error must still hit the StandardMode revert,
   or the plant is left in ScannerMode (100/400). The try/catch around the step loop is the safety net —
   don't add `return`s that bypass it.
2. **Test tilkobling ≠ Save** — Test is AJAX (never `form.submit()`); Save is submitted. Mixing them up
   reloads the page to step 0. (See §5.)
3. **Multiple `#ipSave` in the DOM** — always go through `findVisibleIpSave`, never `querySelector('#ipSave')`.
4. **GM storage is cross-tab** — anything persisted must be namespaced per plant (§3), or two open plants
   corrupt each other's state/logs.
5. **`GM_xmlhttpRequest` + `@connect`** — new hosts/ports need a matching `@connect` header or the request
   is blocked. Current grants: `toolbox.iwmac.local`, `:8505`, `tools.iwmac.local`.
6. **Stale comments** — a couple of inline comments understate real values (e.g. "up to 20s" where the code
   passes `60000`). Trust the argument, not the prose.
7. **`pma_local` dedup** — `_pmaLocalLogged` means the pang log fires once per session; if you split
   `setAk3Mode` you may drop the log. It's intentional and non-fatal.

---

## 8. Constants & GM keys quick-ref

- `LOCAL_IP='192.168.10.10'`, `REMOTE_IP='192.168.10.20'` (fallbacks only — page hints win).
- `X_CALLER='AK3-Autoscan'`; `_runId` per-plant UUID (`X-Run-Id`).
- Timeouts: scan **7200000** (2 h), default-links load **3600000** (1 h), manual-IP wait **24 h**, most
  button/confirm waits **600000** (10 min), generic `waitFor` **30 s**.
- GM keys: `ak3_state_<pid>`, `ak3_log_<pid>` (≤300 lines), `ak3_panel_closed_<pid>` (+ deleted legacy
  globals `ak3_state` / `ak3_log` / `ak3_panel_closed`).

## 9. Key functions — where to find things

`getPlantIdFromHost` (host→id) · `getState`/`setState`/`clearState` (state machine) · `runAk3Setup` (the
step loop — the heart) · `injectMenuButton` (▶ Auto Scan trigger) · `setAk3Mode` + `gmPost` +
`logPmaLocal` + `ensureRunIdForPlant` (mode/SQL/pang) · `detectConfiguredIp` (page-hint IPs) ·
`clickIpSaveUntilConfirmed` / `findVisibleIpSave` / `waitForSaveOrInvalid` / `isRemoteIpInvalid` /
`waitForIpSaveButton` (IP-config resilience) · `clickEl` / `setInput` / `enableButton` / `clickTab` (DOM) ·
`waitFor` / `waitForText` / `sleepLogged` / `waitForTextLogged` (polling) · `injectDebugPanel` /
`renderDebugPanel` / `log` (debug panel) · `fail` (alert + clearState + throw).
