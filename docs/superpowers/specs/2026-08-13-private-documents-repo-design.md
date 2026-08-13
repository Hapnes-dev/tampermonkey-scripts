# Private documents repo split

## Goal

Keep Tampermonkey auto-update working for colleagues from the existing public GitHub `main` URLs, while moving internal documentation, agent briefs, validators, tests, and reference kits out of the current `main` tree into a private repository.

GitHub cannot make a single file public inside a private repository. A README-only public surface would break `@updateURL` / `@downloadURL`. The public repo therefore keeps the installable scripts (and the SQL templates those scripts fetch at runtime). Everything else leaves current `main`.

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

- `README.md` (root only)
- `.gitignore`
- every `*.user.js` in its current folder
- `sql-equipment-import/templates/` including `manifest.json` (runtime fetch from `raw.githubusercontent.com`; Tampermonkey has no GitHub login)

No other files remain on public `main`. In particular, all `CLAUDE.md`, all per-script `README.md`, `docs/`, `iwmac-designer-reference/`, `vv-designer-reference/`, validators, schemas, tests, and fixtures leave public `main`.

Do not bump any userscript `@version`. This is a docs-and-layout change, not a script change.

## Private tree (documents repo)

Mirror the current relative paths so agents and skills still resolve the same files. Examples that must keep their path:

- `CLAUDE.md` (repo-wide)
- `<script-folder>/CLAUDE.md` and `<script-folder>/README.md`
- `iwmac-designer-import-export/iwmac-designer-reference/` (entire tree)
- `logic-designer-import-export/vv-designer-reference/`
- `logic-designer-import-export/validate-vv-sketch.js`
- `logic-designer-import-export/vv-sketch.schema.json`
- `logic-designer-import-export/audit-docs-vs-corpus.js`
- `docs/superpowers/` (this spec moves with the rest of `docs/`)

Do not flatten into a single `documents/` folder.

The private repo starts as a **snapshot** of the current docs files on a new `main`. It does not import the full scripts-repo history.

## History policy

Delete docs from public `main` going forward. Old commits on GitHub and GitLab remain public and still contain the moved files. No `git filter-repo`, no force-push to `main`.

## Public README after the split

Keep the install table. Keep every Install URL byte-identical.

Script-name links that currently point at `<folder>/` may stay (GitHub then shows a folder that contains only the `.user.js`) or become plain text. Prefer keeping the folder links so colleagues can still open the userscript file on GitHub.

Replace the Related paragraph that treats in-repo VV reference material as public source of truth. One short line: internal documentation lives in the private `tampermonkey-scripts-documents` repository. Do not publish a clone URL that implies the docs repo is public.

## Local and Cursor workflow

Two sibling clones, not one repo.

- Script work: public `tampermonkey-scripts`. Bump `@version` only when a `.user.js` changes. Push both remotes.
- Docs / validator / fixture / briefing work: private `tampermonkey-scripts-documents`. No userscript version bump. Push both remotes.

After the split, Cursor in a scripts-only worktree will not auto-load the moved `CLAUDE.md` files. Open the private repo (or a multi-root workspace) for designer-kit, VV, or documentation tasks.

Do not add new `CLAUDE.md`, contracts, or tests back onto public `main`.

## Consequences (accepted, out of this job)

- Anonymous raw GitHub fetches of `AI-BRIEFING.txt`, `AI-EXAMPLES.txt`, `BLOCKS.md`, and `vv-sketch.schema.json` stop working. Copilot / ChatGPT must use a local private clone or an attached knowledge file.
- `Hapnes-dev/agent-skills/vv-designer-sketch` remains a public packaged copy of VV docs. Privatizing or stripping that skill is a separate job.
- KnowledgeVault pins and Graphify counts for `tampermonkey-scripts` become stale when public `main` shrinks. Re-pin later through the vault transaction workflow, not in this split.
- A GitLab invite for a colleague who needs the docs belongs on the **private** documents repo, not the public scripts repo. Public Tampermonkey updates need no invite.

## Migration steps

1. Create GitHub `Hapnes-dev/tampermonkey-scripts-documents` as private (`gh repo create`).
2. Create GitLab `thomas.kvalvag/tampermonkey-scripts-documents` as private (API or GitLab UI).
3. Copy the current docs tree (everything not on the public allowlist) into the new repo and push `main` to both private remotes.
4. In the public scripts repo, delete the moved files, edit root `README.md` as specified, commit, and push `origin` and `gitlab`.
5. Confirm Tampermonkey raw URLs still 200 for every `.user.js` and for `sql-equipment-import/templates/manifest.json`.
6. Confirm public `main` file browser no longer lists `CLAUDE.md`, per-script READMEs, or reference trees.

## Success criteria

- Colleagues with Tampermonkey still receive updates from the same `@updateURL` / `@downloadURL` values.
- Public GitHub `main` shows root `README.md`, the `.user.js` files, SQL templates, and `.gitignore` only.
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
