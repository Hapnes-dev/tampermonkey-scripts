# Claude Code Guide — tampermonkey-scripts

## Repo overview

Public GitHub repo: `https://github.com/hapnes-dev/tampermonkey-scripts`
Local path: `C:\Users\ThomasKvalvåg\Documents\ak3 scan`
Owner: hapnes-dev

A collection of Tampermonkey userscripts with auto-update support. Each script lives in its own subfolder.

## Folder structure

```
tampermonkey-scripts/
├── README.md                     # Root index — table of all scripts with install links
├── CLAUDE.md                     # This file
├── ak3-autoscan/                 # Automates the AK3 scanner setup workflow on IWMAC plant servers
├── iwmac-topology-copy/          # Copy/export topology + inject live driver columns on sys_tools
├── oneflow-copy-products/        # Copy product lists on Oneflow (tilbud PDF) + HubSpot (deal line items)
├── rocketlane-chat-bridge/       # Bridges Rocketlane's API to the local Project Progress Tracker (CORS bypass)
├── rocketlane-day-recap/         # My Timesheet: plants visited per day, hours, action chips, config-change drawer
├── rocketlane-enhancer/          # Hides the Gantt calendar + adds a floating chat panel on Rocketlane
├── rocketlane-project-notes/     # Writable Note column on the Rocketlane Projects list (SQL-persisted)
└── sql-equipment-import/         # phpMyAdmin panel: load a driver-template .sql, edit units/Modbus, emit SQL
```

Each folder holds `<script>.user.js` (the userscript installed in Tampermonkey) and a `README.md` (AI reference docs for that script).

## How Tampermonkey auto-update works

Each `.user.js` file has these headers:
- `@updateURL` — Tampermonkey checks this URL periodically for version changes
- `@downloadURL` — Tampermonkey downloads the new script from here
- `@version` — Tampermonkey compares this to detect updates

URLs follow the pattern:
```
https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/<folder>/<script>.user.js
```

**IMPORTANT:** You MUST bump `@version` every time you push changes, otherwise users won't get the update.

**CRITICAL:** ALWAYS bump the `@version` number with EVERY change, no exceptions. This is a BLOCKING requirement before committing.

## How to make changes

**IMPORTANT:** After EVERY change, you MUST commit and push to GitHub. Users receive updates via Tampermonkey auto-update, so changes only take effect once pushed.

**IMPORTANT:** NEVER edit old local copies (e.g. `Ak3.js.txt`). ALWAYS edit files inside their subfolder (e.g. `ak3-autoscan/AK3-Autoscan.user.js`).

**IMPORTANT:** Before editing OR committing a `.user.js`, scan `C:\Users\ThomasKvalvåg\Downloads\` for a Tampermonkey export of that script (filename pattern: `<Script Name>-<version>.txt`). If the export's `@version` is HIGHER than the repo's, sync that file into the repo FIRST — convert LF → CRLF to match the repo's existing line endings — otherwise editing/pushing the repo version will downgrade the user's installed script on Tampermonkey auto-update.

### 1. Edit the script
Make changes to the `.user.js` file in the correct subfolder.

### 2. Bump the version
In the `// ==UserScript==` header, increment `@version` (e.g. 5.2 → 5.3).

### 3. Update the subfolder README if needed
If workflow steps changed, update the AI reference README in the same folder.

### 4. Commit and push (ALWAYS do this)
```bash
cd "C:\Users\ThomasKvalvåg\Documents\ak3 scan"
git add <changed-files>
git commit -m "Description of changes"
git push
```

The `gh` CLI is installed and authenticated as `hapnes-dev`.

## Adding a new script

1. Create a new folder: `mkdir <script-name>`
2. Add the `.user.js` file with these required headers:
   ```js
   // @namespace    https://github.com/hapnes-dev/tampermonkey-scripts
   // @homepageURL  https://github.com/hapnes-dev/tampermonkey-scripts
   // @updateURL    https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/<folder>/<script>.user.js
   // @downloadURL  https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/<folder>/<script>.user.js
   ```
3. Add a `README.md` in the folder with an install link and AI reference docs
4. Add a row to the **root README.md** table:
   ```md
   | [Script Name](<folder>/) | Description | [Install](https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/<folder>/<script>.user.js) |
   ```
5. Commit and push

## Git config

- Remote: `origin` → `https://github.com/hapnes-dev/tampermonkey-scripts.git`
- Branch: `main`
- Auth: `gh` CLI authenticated as `hapnes-dev`
- User: `hapnes-dev` / `hapnes-dev@users.noreply.github.com`
