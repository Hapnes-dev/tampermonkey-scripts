# Private documents repo split

## Goal

Keep Tampermonkey auto-update working for colleagues from the existing public GitHub `main` URLs, while moving internal documentation, agent briefs, Python validators, tests, SQL templates, and reference kits out of the current `main` tree into a private repository.

GitHub cannot make a single file public inside a private repository. A README-only public surface would break `@updateURL` / `@downloadURL`. The public repo therefore keeps every tracked `.js` file (installable userscripts and helper scripts) and every `README.md`. Everything else leaves current `main`.

## Approach

Keep `Hapnes-dev/tampermonkey-scripts` public. Create a new private docs repo. Delete moved files from public `main` only. Do not rewrite git history.

## Repositories

| Role | GitHub | GitLab | Visibility |
|---|---|---|---|
| Scripts (unchanged name) | `Hapnes-dev/tampermonkey-scripts` | `thomas.kvalvag/tampermonkey-scripts` | public |
| Documents (new) | `Hapnes-dev/tampermonkey-scripts-documents` | `thomas.kvalvag/tampermonkey-scripts-documents` | private |

Dual-push continues on both repos: `git push origin HEAD` then `git push gitlab HEAD`. Tampermonkey still reads GitHub `main` of the scripts repo.

If GitLab project creation fails because the local credential has git scope only (no `api`), create the empty private GitLab project in the GitLab UI, add the `gitlab` remote, then push. Do not store a GitLab token in git, vault, or memory.

## Public allowlist (scripts repo `main`)

These paths stay in the public repository:

- every `README.md` at any depth (root, each script folder, and the two fixture READMEs under `iwmac-designer-import-export/iwmac-designer-reference/tests/fixtures/`)
- every `*.js` at any depth, including `*.user.js` and helpers (`validate-vv-sketch.js`, `audit-docs-vs-corpus.js`, `tests/*.js`, `survey-batch.js`, `ventilation-survey-20.js`)
- `.gitignore` (git hygiene, not documentation)

No other files remain on public `main`. **Not** public: `sql-equipment-import/templates/` (`.sql` + `manifest.json`), every `CLAUDE.md` and `CLAUDE-*.md` at any depth (root, each script folder, nested reference folders), `docs/`, Python validators, schemas, fixtures except their `README.md`, and the rest of `iwmac-designer-reference/` and `vv-designer-reference/`.

`CLAUDE.md` is not a `README.md`. It never stays on public `main`. After the split, a public script folder such as `ak3-autoscan/` contains only `AK3-Autoscan.user.js` and `README.md`.

SQL templates stay private. That is an accepted break of the phpMyAdmin template fetch until a later userscript change.

Tracked Claude instruction files that must all be private (17):

- `CLAUDE.md`
- `ak3-autoscan/CLAUDE.md`
- `iwmac-designer-import-export/iwmac-designer-reference/CLAUDE.md`
- `iwmac-designer-import-export/iwmac-designer-reference/CLAUDE-REVISED.md`
- `iwmac-topology-copy/CLAUDE.md`
- `logic-designer-copy-paste/CLAUDE.md`
- `logic-designer-import-export/CLAUDE.md`
- `logic-designer-import-export/vv-designer-reference/CLAUDE.md`
- `oneflow-copy-products/CLAUDE.md`
- `rocketlane-chat-bridge/CLAUDE.md`
- `rocketlane-day-recap/CLAUDE.md`
- `rocketlane-enhancer/CLAUDE.md`
- `rocketlane-project-notes/CLAUDE.md`
- `rocketlane-younium-status/CLAUDE.md`
- `sql-equipment-import/CLAUDE.md`
- `supermarket-superuser/CLAUDE.md`
- `younium-order-to-quote/CLAUDE.md`

A later `CLAUDE.md` or `CLAUDE-*.md` anywhere in the tree follows the same rule: private documents repo only. Never add one back onto public `main`. There is no `iwmac-designer-import-export/CLAUDE.md` at the script-folder level today; if one is added later it is private too.

Do not bump any userscript `@version`. This is a docs-and-layout change, not a script change.

## Private tree (documents repo)

Mirror the current relative paths so agents and skills still resolve the same files. Examples that must keep their path:

- every `CLAUDE.md` (root, each script folder, nested `iwmac-designer-reference/` and `vv-designer-reference/`)
- `sql-equipment-import/templates/`
- `iwmac-designer-import-export/iwmac-designer-reference/` except any `.js` and `README.md` that stay public
- `logic-designer-import-export/vv-designer-reference/`
- `logic-designer-import-export/vv-sketch.schema.json`
- Python validators, fixtures (except fixture `README.md`), and tests that are not `.js`
- `docs/superpowers/` (this spec moves with the rest of `docs/`)

Helper `.js` files stay in the public scripts repo only. Do not delete them from public `main`. The private repo does not need a second copy unless a later job wants a self-contained documents clone.

Do not flatten into a single `documents/` folder.

The private repo starts as a **snapshot** of the current docs files on a new `main`. It does not import the full scripts-repo history.

## History policy

Delete docs from public `main` going forward. Old commits on GitHub and GitLab remain public and still contain the moved files. No `git filter-repo`, no force-push to `main`.

## Public README after the split

Keep the install table. Keep every Install URL byte-identical.

Script-name links that currently point at `<folder>/` stay. GitHub then shows that folder’s `README.md` plus the `.user.js`.

Replace the Related paragraph that treats in-repo VV reference material as public source of truth. One short line: internal documentation lives in the private `tampermonkey-scripts-documents` repository. Do not publish a clone URL that implies the docs repo is public.

## Local and Cursor workflow

Two sibling clones, not one repo.

- Script work: public `tampermonkey-scripts`. Bump `@version` only when a `.user.js` changes. Push both remotes.
- Docs / Python validator / fixture / briefing work: private `tampermonkey-scripts-documents`. No userscript version bump. Push both remotes.
- Helper `.js` edits stay in the public scripts repo (they are on the public allowlist).

After the split, Cursor in a scripts-only worktree will not auto-load the moved `CLAUDE.md` files. Open the private repo (or a multi-root workspace) for designer-kit, VV, or documentation tasks.

Do not add new `CLAUDE.md`, contracts, Python, SQL templates, or non-README Markdown back onto public `main`. `.js` and `README.md` may still be added there.

## Consequences (accepted, out of this job)

- Anonymous raw GitHub fetches of `AI-BRIEFING.txt`, `AI-EXAMPLES.txt`, `BLOCKS.md`, and `vv-sketch.schema.json` stop working. Copilot / ChatGPT must use a local private clone or an attached knowledge file.
- `SQL-Equipment-Import.user.js` fetches `https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/sql-equipment-import/templates/` (`REPO_BASE`, `@connect raw.githubusercontent.com`). After this split that URL 404s. Reloading templates in phpMyAdmin breaks until a later userscript change (bundle templates, or a new public URL) with an `@version` bump. Out of this job.
- `Hapnes-dev/agent-skills/vv-designer-sketch` remains a public packaged copy of VV docs. Privatizing or stripping that skill is a separate job.
- KnowledgeVault pins and Graphify counts for `tampermonkey-scripts` become stale when public `main` shrinks. Re-pin later through the vault transaction workflow, not in this split.
- A GitLab invite for a colleague who needs the docs belongs on the **private** documents repo, not the public scripts repo. Public Tampermonkey updates need no invite.

## Migration steps

1. Create GitHub `Hapnes-dev/tampermonkey-scripts-documents` as private (`gh repo create`).
2. Create GitLab `thomas.kvalvag/tampermonkey-scripts-documents` as private (API or GitLab UI).
3. Copy the current docs tree (everything not on the public allowlist) into the new repo and push `main` to both private remotes.
4. In the public scripts repo, delete the moved files, edit root `README.md` as specified, commit, and push `origin` and `gitlab`.
5. Confirm Tampermonkey raw URLs still 200 for every `.user.js`. Expect `sql-equipment-import/templates/manifest.json` to 404.
6. Confirm public `main` lists only `README.md`, `*.js`, and `.gitignore`. `git ls-files '*CLAUDE*'` on public `main` is empty. `sql-equipment-import/templates/` is absent. Helper `.js` remain.

## Success criteria

- Colleagues with Tampermonkey still receive updates from the same `@updateURL` / `@downloadURL` values.
- Public GitHub `main` shows `README.md`, `*.js` (userscripts and helpers), and `.gitignore` only. Zero `CLAUDE.md`. Zero `CLAUDE-*.md`. Zero SQL templates.
- The private clone still has the full documentation and validator kit at the same relative paths.
- No userscript `@version` change. No force-push. No history rewrite.

## Non-goals

- Making the current repo private.
- A new public scripts-only repository (would break existing installs).
- Git submodules.
- Rewriting public git history.
- Changing Tampermonkey metadata URLs.
- Privatizing `agent-skills`.
- Vault re-pin in this pass.
- GitLab invites in this pass.
