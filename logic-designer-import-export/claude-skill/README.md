# `vv-designer-sketch` — a Claude agent skill

Packages this folder's VV Designer reference material as an [agent skill](https://docs.claude.com/en/docs/agents-and-tools/agent-skills/overview),
so Claude picks it up **automatically** when you describe plant logic — instead of you
pasting `AI-BRIEFING.txt` and `AI-EXAMPLES.txt` into every new chat.

Same contract, same validator, same nine worked examples. The difference is that the
knowledge arrives when it's needed, and the model runs
[`validate-vv-sketch.js`](../validate-vv-sketch.js) on its own output before handing it
to you, which is the step that catches the failure classes documented in
[`CLAUDE.md` §20.8/§20.9](../vv-designer-reference/CLAUDE.md).

## Install

**Claude Code** (per-user, works in every project):

```bash
git clone https://github.com/hapnes-dev/tampermonkey-scripts.git
cp -r tampermonkey-scripts/logic-designer-import-export/claude-skill ~/.claude/skills/vv-designer-sketch
```

On Windows PowerShell:

```powershell
Copy-Item -Recurse tampermonkey-scripts\logic-designer-import-export\claude-skill $env:USERPROFILE\.claude\skills\vv-designer-sketch
```

Restart Claude Code. Confirm it registered by asking something like *"alarm if the cold
room goes above 8 °C for 15 minutes on plant 5440"* — the skill should trigger without
you naming it.

**Claude.ai / Cowork**: zip this folder and upload it under Settings → Capabilities → Skills.

Requires **Node** on PATH for the bundled validator (`node --version`).

## What it does

| You ask | It does |
|---|---|
| "alarm if the freezer goes above −15 for 10 min, plant 9652" | Generates the importable sketch JSON, leaves unknown bindings as red `TODO bind` blocks, validates before answering |
| "here's the Live Simulate log, why isn't the alarm firing?" | Reads the SUMMARY / WHAT-THE-ERRORS-MEAN / FLOW sections and walks the trace back to the offending block |
| "this file got rejected on import, here's the report" | Applies the numbered fixes and returns one complete corrected file |
| "make this a reusable process for the library" | Emits a `mode: "process"` definition with `PROCESSIN` pins and no `PARAMV` |
| "what does this exported sketch actually do?" | Reads it as a graph, tolerating legacy shapes (singular `driver_id`, id gaps, unwired helper blocks) |

Deployment and hardware writes stay your decision — the skill is explicit about never
assuming them.

## Layout

```
claude-skill/
├── SKILL.md      the skill itself — mental model, contract, block table, recipes
├── references/   briefing.txt · examples.txt · blocks.md · vv-sketch.schema.json
├── scripts/      validate-vv-sketch.js
└── sync.js       refresh the copies from the canonical docs
```

## Keeping it current

`references/` and `scripts/` are **copies** — an installed skill can't reach back into
this repo, so it has to be self-contained. The originals in
[`vv-designer-reference/`](../vv-designer-reference/) and
[`validate-vv-sketch.js`](../validate-vv-sketch.js) remain the source of truth.

After editing any of them:

```bash
node sync.js
```

`node sync.js --check` reports drift without writing and exits non-zero — handy before a
commit. `SKILL.md` is maintained by hand; if a host update changes the block contract,
update the reference docs first, re-run `sync.js`, then adjust `SKILL.md`'s inline block
table to match.
