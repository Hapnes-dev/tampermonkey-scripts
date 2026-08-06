# Claude Code Guide — tampermonkey-scripts

## Repo overview

Public GitHub repo: `https://github.com/Hapnes-dev/tampermonkey-scripts`
Local path: `C:\Users\Thomas\Documents\Claude\repos\tampermonkey-scripts`
Owner: Hapnes-dev

> **This file is not auto-loaded.** Sessions open `C:\Users\Thomas\Documents\Claude`
> (see that folder's `CLAUDE.md`), and Claude Code reads `CLAUDE.md` from the
> working directory and its parents — never from subdirectories. Read this file
> explicitly before changing anything here.

A collection of Tampermonkey userscripts with auto-update support. Each script lives in its own subfolder.

## Folder structure

```
tampermonkey-scripts/
├── README.md                     # Root index — table of all scripts with install links
├── CLAUDE.md                     # This file
├── ak3-autoscan/                 # Automates the AK3 scanner setup workflow on IWMAC plant servers
├── iwmac-designer-import-export/ # Panel JSON export/copy/insert on the IWMAC Designer (legacy.iwmac.local) w/ driver-id rebinding + embedded background (+ iwmac-designer-reference/: the designer deep-dive docs, reference_data)
├── iwmac-topology-copy/          # Copy/export topology + inject live driver columns on sys_tools
├── logic-designer-copy-paste/    # Copy/paste (Ctrl+C/V + Ctrl+B ghost), multi-wire (Shift+F), remove-connectors (Shift+D), drag-move undo, type colors, sketch quick-open, formula editor, sketch-info pill, alarm→block highlight on the VV Designer (Henrik Monge)
├── logic-designer-import-export/ # Export/Import sketch (JSON) in the VV Designer File menu — move logic between plants w/ driver-id rebinding (+ vv-designer-reference/: the VV Designer deep-dive docs, AI briefing/examples, reference_data)
├── oneflow-copy-products/        # Copy product lists on Oneflow (tilbud PDF) + HubSpot (deal line items)
├── rocketlane-chat-bridge/       # Bridges Rocketlane's API to the local Project Progress Tracker (CORS bypass)
├── rocketlane-day-recap/         # My Timesheet: plants visited per day, hours, action chips, config-change drawer
├── rocketlane-enhancer/          # Hides the Gantt calendar + adds a floating chat panel on Rocketlane
├── rocketlane-project-notes/     # Writable Note column on the Rocketlane Projects list (SQL-persisted)
├── rocketlane-younium-status/    # ☄️ Younium button on the Rocketlane project nav → plant Younium order/subscription status modal
├── sql-equipment-import/         # phpMyAdmin panel: load a driver-template .sql, edit units/Modbus, emit SQL
├── supermarket-superuser/        # IWMAC Supermarket parameters page power-tools: filters, edit/move mode (att r⇄rw), batch driver-parameter editing + cross-unit copy, xlsx export (ØTS/MATS/Hapnes)
└── younium-order-to-quote/       # 📦 Copy from order button on Younium quote pages → copies an order's products (qty + discount %) onto the quote
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

**IMPORTANT:** Before editing OR committing a `.user.js`, scan `C:\Users\Thomas\Downloads\` for a Tampermonkey export of that script (filename pattern: `<Script Name>-<version>.txt`). If the export's `@version` is HIGHER than the repo's, sync that file into the repo FIRST — convert LF → CRLF to match the repo's existing line endings — otherwise editing/pushing the repo version will downgrade the user's installed script on Tampermonkey auto-update.

### 1. Edit the script
Make changes to the `.user.js` file in the correct subfolder.

### 2. Bump the version
In the `// ==UserScript==` header, increment `@version` (e.g. 5.2 → 5.3).

> **`rocketlane-chat-bridge` specifically:** the Project Progress Tracker `.html` checks this bridge's live `@version` on every load (`checkBridgeUpdate` → fetches `@version` from the canonical raw URL) and pops an **"Update bridge"** card whenever the user's installed copy is behind. The check is version-agnostic, so **just bumping `@version` here is all the tracker needs to prompt users to the newest bridge** — no `.html` change required. Also sync the PPT-repo snapshot `Project-Progress-Tracker/rocketlane-chat-bridge/rocketlane-chat-bridge.user.js` to match.

### 3. Update the subfolder README if needed
If workflow steps changed, update the AI reference README in the same folder.

### 4. Commit and push (ALWAYS do this)
```bash
cd "C:\Users\Thomas\Documents\Claude\repos\tampermonkey-scripts"
git add <changed-files>
git commit -m "Description of changes"
git push
```

The `gh` CLI is installed and authenticated as `Hapnes-dev`.

Committing here fires the repo's `post-commit` hook, which rebuilds
`graphify-out/` automatically. That covers **this repository only** — the
combined graph at `repos/graphify-out/` needs an explicit
`graphify merge-graphs`, and the Obsidian vault needs its pin and counts
refreshed in the same pass. See "After the push" below.

### 5. After the push — keep the knowledge layers honest

The vault at `Documents\KnowledgeVault` pins this repo to a specific commit and
quotes its Graphify counts. A push falsifies both. In the same pass:

- Re-pin `wiki/sources/GitHub - tampermonkey-scripts.md` to the new commit, and
  supersede the old snapshot claim in the claim ledger rather than overwriting
  it — a superseded claim stays true of its own date.
- Fix any statement the change falsified (e.g. version numbers, line counts, or
  the `Tampermonkey Userscript Catalog` table). A claim that was *wrong when
  written* is corrected in place; one *overtaken by a newer snapshot* is
  superseded.
- Re-merge the combined graph if the counts are quoted anywhere.
- Vault writes go through the reviewed `claude-obsidian` transaction workflow
  under WSL 2 — never a direct file overwrite.

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
