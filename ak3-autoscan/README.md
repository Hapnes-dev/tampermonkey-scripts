# AK3-Autoscan

## Install

> Requires [Tampermonkey](https://www.tampermonkey.net/) browser extension.

### [Click here to install AK3 Auto Scan](https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/ak3-autoscan/AK3-Autoscan.user.js)

The script auto-updates — when a new version is pushed here, Tampermonkey will update it automatically.

---

## AI Reference

> Compact context for Claude / AI assistants. Read this instead of the full script to save tokens.

## What it is

A Tampermonkey userscript (`AK3-Autoscan.user.js`, v9.3) that automates the AK3 scanner setup workflow on `*.plants.iwmac.local:8080/secure/ak3_setup/*`.

## Key constants

| Constant | Value |
|---|---|
| `LOCAL_IP` | `192.168.10.10` |
| `REMOTE_IP` | `192.168.10.20` |
| `STATE_KEY` | `ak3_state_<plantId>` (GM storage, per-plant) |
| `LOG_KEY` | `ak3_log_<plantId>` (GM storage, per-plant, max 1500 lines) |
| `PANEL_CLOSED_KEY` | `ak3_panel_closed_<plantId>` (GM storage, per-plant) |
| `SUMMARY_KEY` | `ak3_summary_<plantId>` (GM storage, per-plant run summary behind the completion card) |
| `X_CALLER` | `AK3-Autoscan` |

## Multi-plant isolation

GM storage is shared across all tabs running this script. To allow scanning multiple plants in parallel without cross-talk, the workflow state, log buffer, and panel-closed flag are all namespaced by the plant id parsed from the tab's host (`<plantId>.plants.iwmac.local`). Each tab is bound to one plant via its URL, so per-plant keys give per-tab isolation — the debug panel only shows logs for the plant in that tab.

## Run control (start / resume / abort)

Nothing runs by itself on page load. The saved state (`{ plantId, step, ts, runId, resumes, pmaLogged }`)
outlives a reload, and the page then shows the debug panel with **▶ Resume** and **■ Abort**; the menu
button reads **▶ Resume Auto Scan** and asks whether to resume the paused run or start over.

| Action | What happens |
|---|---|
| **Start** (`startRun`) | clears the log, saves `step: dbcheck`, sets ScannerMode, runs the loop |
| **Resume** (`resumeRun`) | re-applies ScannerMode (a reload may have reset the packet settings), bumps `resumes`, runs the loop from the saved step. A step resumed more than 3 times without advancing stops the run and reverts to StandardMode instead of looping |
| **Abort** (`abortRun`) | reverts to StandardMode, clears the saved run, makes every wait in a running loop bail out |

Only one loop can run per tab (`_running`); clicking the menu button during a run offers Abort.

## Workflow steps (linear state machine)

Each step is persisted in GM storage so a reload pauses the run instead of losing it.

### 1. `dbcheck`
- Opens the **DB Sjekk** tab (`li#databasetest`)
- If both `.test-box` entries for `iw_plant_server3` and `iw_ak3_scanner` carry class `ok` (text `OK` as a whole word is the fallback; `error` / `IKKE OK` never count), skips to next step
- If `button#create_scan_db` ("Lag database iw_ak3_scanner") exists, clicks it and waits for `"Database opprettet"` message
- Proceeds to ipconfig

### 2. `ipconfig`
- Opens the **IP Config** tab
- Reads the "config satt til" hints in the page `<h2>`s:
  - `Server config satt til <em>…</em>` → `localIp`
  - `AK-SM850 config satt til <em>…</em>` → `remoteIp` (IP is extracted even if wrapped in a URL)
- Falls back to defaults (`localIp` = `192.168.10.10`, `remoteIp` = `192.168.10.20`) only if no IP is present in the hint
- Enables HTTPS checkbox (`setCheckbox`: one native click, verified), clicks **"Test tilkobling til AK-SM850"**
- If test fails (no Save button), disables HTTPS and retries up to 5 times with increasing wait
- Clicks **"Lagre ip-adresser i scanner database"**, waits for `"IPer oppdatert"`
- If all retries fail, shows a yellow banner and waits indefinitely for user to fix manually; declining the "Continue?" prompt afterwards reverts to StandardMode and stops

### 3. `scan`
- Opens the **Scan** tab, clicks **"Scan anlegg"**
- Polls an iframe for `#percent` reaching `100%` or `#done` containing `"Scan done"`; a finished result still shown from an earlier scan is ignored until the window resets
- Logs progress every 10 %
- Afterwards re-opens the Scan tab and diffs its "tidligere funnet" regulator list against the one read before the scan: the card shows the count, the new regulators by name, and any no longer listed
- **Timeout: 2 hours** (7,200,000 ms)

### 4. `default_links`
- Opens **Default links** tab
- Clicks **"Sett alle til forste med Therm"** then **"Lagre default links"**
- Waits for `"Default links oppdatert"`

### 5. `copyplant`
- Opens **"Kopier til anlegg"** tab
- Clicks **"Kopier og overskriv ALT"**, auto-confirms the dialog if it appears within 3 s
- Waits for `"Database kopiert"`

### 6. `activate`
- Opens **"Aktiver anlegg"** tab, clicks **"Aktiver alle"**
- Waits for `"Enheter aktivert"`
- Sets AK3 mode back to **StandardMode** (a failed revert is flagged on the card), clears state, shows the **completion card**: duration, per-step times and results (DB created or present, IPs used and HTTPS/HTTP, regulators found and new, the page's own confirmation lines), AK3 mode, run id, an amber "Remember to restart IWMAC Escape!" line (the page's "Husk å restart pc!" is dropped from the Copy row), Copy summary (`GM_setClipboard`, since the clipboard API is unavailable on `http://`), Show log (the full run log inside the card, with Copy log) and Close. The tab title gets a `✔ AK3 done` prefix and a desktop notification is sent (`GM_notification`)

## AK3 mode switching

| Mode | packet_timeout | packet_interval |
|---|---|---|
| ScannerMode (start and resume) | 100 | 400 |
| StandardMode (completion, failure, abort, user decline) | 10 | 4000 |

Done via SQL UPDATE to `iw_plant_server3.iw_sys_plant_settings` through `http://toolbox.iwmac.local:8505/plant-sql/`.
Also logs `pma_local` via JSON-RPC to `http://tools.iwmac.local/services/pang/actions.php`.

## UI elements

- **"Auto Scan" button**: Green button injected at top of `#mainmenu` sidebar; label follows the state (`▶ Auto Scan`, `▶ Resume Auto Scan`, `⏳ Auto Scan running…`)
- **Debug panel**: Fixed top-right overlay with timestamped log. Has Resume/Abort (shown while a run is saved), clear, minimize and close buttons. Shown during a run and again on every load while a run is saved.
- **Completion card**: Centered dark overlay shown when the run finishes (see step 6). Close with the button or Escape.

## Helper functions

| Function | Purpose |
|---|---|
| `waitFor(selector, {timeout})` | Polls DOM for element, default 30s |
| `waitForText(selector, text, {timeout})` | Polls DOM for element containing text, default 30s |
| `clickEl(el)` | One native `.click()` (buttons and tabs, never checkboxes) |
| `clickVerified(el, label, effect, ms)` | Native click, then waits for `effect()`; escalates to a synthetic `MouseEvent` and a jQuery trigger only if nothing happened. Used for tabs, Test tilkobling, Scan anlegg, Kopier, Aktiver |
| `setCheckbox(el, want)` | One native click if the state differs, then verify and force-set |
| `revertToStandardMode(plantId)` | Best-effort StandardMode revert, logs a WARNING instead of throwing |
| `stopRun(msg)` | Clears state, logs, alerts — callers revert first |
| `isOkStatus(txt)` | Whole-word `OK`, not negated |
| `stepStarted` / `noteStep` / `stepDone` / `msgText` | Record the run summary per step |
| `showCompletionCard(plantId, summary)` | Render the completion card; falls back to `alert()` if rendering throws |
| `readScanDeviceList()` | Parse the Scan tab's regulator list (`0_5 - K 1 … ( serial )`) |
| `copyText(text)` | `GM_setClipboard`, then `execCommand('copy')`, then the clipboard API |
| `setInput(el, value)` | Sets value via property descriptor + fires input/change/keyup/blur |
| `enableButton(el)` | Force-enables a disabled button |
| `gmPost(url, body)` | `GM_xmlhttpRequest` POST wrapper returning parsed JSON |
| `sleep(ms)` | Promise-based delay |
| `clickTab(id)` | Clicks `li#id` once and waits for `#content` to be replaced (hidden probe element), up to 6 s per strategy |

## GM grants

`GM_setValue`, `GM_getValue`, `GM_deleteValue`, `GM_xmlhttpRequest`, `GM_notification`, `GM_setClipboard`

## Files

| File | Purpose |
|---|---|
| `AK3-Autoscan.user.js` | Main userscript (install in Tampermonkey) |

## Failure handling

Any error thrown inside the step loop reaches one catch: it reverts to StandardMode first, then `stopRun(msg)` clears state, logs and shows a single alert. Abort, a declined "Continue?" prompt and completion revert the same way. Non-critical errors (e.g. `pma_local` logging) are caught and logged but don't stop the workflow.
