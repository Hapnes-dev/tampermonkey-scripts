# IWMAC Light-Background Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every newly generated IWMAC Designer panel background light while allowing an existing dark production background to remain only during an explicitly requested edit of that same panel.

**Architecture:** Change only the normative generation contract in `AI-BRIEFING.txt`. Replace the broad dark Maskin exception with light-only generation guidance, retain dark artwork as preservation-only input, and add a final compliance check. Verify the contract with deterministic text assertions plus the existing reference test suite before amending PR #2.

**Tech Stack:** Plain-text documentation, Python 3 assertions, `unittest`, Git, GitHub CLI.

## Global Constraints

- Every newly generated canvas or background artwork must use a light base: white, off-white, or light grey.
- Existing dark production artwork may remain only when the user explicitly requests an edit to that same panel.
- Never introduce, expand, or select dark background styling during an existing-panel edit.
- Dark foreground controls, setpoint boxes, pipes, borders, labels, and status indicators remain allowed.
- `maskin-dark-style-example.png` is historical/reference evidence, not a generation target.
- Modify `iwmac-designer-import-export/iwmac-designer-reference/AI-BRIEFING.txt` only during implementation.
- Do not edit `.user.js`, `@version`, production JSON, reference JSON, or runtime behavior.
- Amend existing PR #2; do not merge without fresh action-time approval.

---

### Task 1: Enforce light-only generated backgrounds

**Files:**
- Modify: `iwmac-designer-import-export/iwmac-designer-reference/AI-BRIEFING.txt:54-103`
- Modify: `iwmac-designer-import-export/iwmac-designer-reference/AI-BRIEFING.txt:662-676`
- Test: deterministic inline Python assertions against `AI-BRIEFING.txt`

**Interfaces:**
- Consumes: approved policy from `docs/superpowers/specs/2026-08-09-iwmac-light-background-generation-design.md`.
- Produces: normative prose containing `NEWLY GENERATED backgrounds MUST always be light`, a preservation-only existing-dark rule, and a matching self-check item.

- [ ] **Step 1: Run the failing contract test**

```bash
python - <<'PY'
from pathlib import Path

path = Path('iwmac-designer-import-export/iwmac-designer-reference/AI-BRIEFING.txt')
text = path.read_text(encoding='utf-8')
assert 'NEWLY GENERATED backgrounds MUST always be light' in text
assert 'existing dark production background' in text
assert 'explicitly asks to edit that SAME panel' in text
assert 'dark-variant maskin is the sanctioned' not in text
assert 'DARK (near-black, see the dark example png)' not in text
assert 'newly generated background is light' in text
PY
```

Expected: FAIL on missing `NEWLY GENERATED backgrounds MUST always be light`.

- [ ] **Step 2: Strengthen the general background rule**

Replace the sentence at lines 69-70 with this exact rule:

```text
   NEWLY GENERATED backgrounds MUST always be light: white, off-white or
   light grey. Never cover the canvas in dark colours. Dark colours are
   allowed only on bounded foreground controls, setpoint boxes, pipes,
   borders, labels and status indicators. Never draw values or symbols the
   OBJECTS already provide (no fake numbers, LEDs or fans in the SVG).
```

After the `background_embedded` sentence, add:

```text
When editing an existing production panel, preserve its dark background only
if the user explicitly asks to edit that SAME panel. Do not introduce, expand
or select dark styling. A trace, reference image or plant style never permits
a dark background for newly generated artwork.
```

- [ ] **Step 3: Remove the dark Maskin generation exception**

Replace the two-skin block at lines 92-99 with:

```text
- Generation skin: LIGHT only - canonical reference
  maskin-light-style-reference.png, rendered 1:1 from the Illustrator source
  maskin-light-template.ai; its real layers are Backround / Ror / Maskinrom.
  maskin-dark-style-example.png is historical/reference evidence only, never
  a generation target. Preserve a dark Maskin background only for an explicit
  edit of that same existing production panel; never introduce or expand it.
  Vrec is the receiver FLASH-GAS valve: draw it on the cyan suction-side
  line, never on the yellow liquid line.
```

Keep layout doctrine, circuit colours, symbol rules, and worked light example unchanged.

- [ ] **Step 4: Add generated-output self-check**

Insert before `raw JSON only`:

```text
[] newly generated background is light (white, off-white or light grey);
   dark existing artwork is preserved only for an explicitly requested edit
   of that same panel, never selected for new generation
```

- [ ] **Step 5: Run the contract test again**

```bash
python - <<'PY'
from pathlib import Path

path = Path('iwmac-designer-import-export/iwmac-designer-reference/AI-BRIEFING.txt')
text = path.read_text(encoding='utf-8')
assert 'NEWLY GENERATED backgrounds MUST always be light' in text
assert 'existing production panel' in text
assert 'explicitly asks to edit that SAME panel' in text
assert 'dark-variant maskin is the sanctioned' not in text
assert 'DARK (near-black, see the dark example png)' not in text
assert 'newly generated background is light' in text
assert 'maskin-dark-style-example.png is historical/reference evidence only' in text
PY
```

Expected: PASS.

- [ ] **Step 6: Run full reference tests**

```bash
python -m unittest discover \
  -s iwmac-designer-import-export/iwmac-designer-reference/tests -v
```

Expected: 16 tests pass.

- [ ] **Step 7: Validate diff scope and formatting**

```bash
git diff --check
python - <<'PY'
import subprocess

changed = subprocess.check_output(['git', 'diff', '--name-only'], text=True).splitlines()
expected = ['iwmac-designer-import-export/iwmac-designer-reference/AI-BRIEFING.txt']
assert changed == expected, changed
assert not any(path.endswith('.user.js') for path in changed)
diff = subprocess.check_output(['git', 'diff', '--unified=0'], text=True)
assert '@version' not in diff
assert 'dark-variant maskin is the sanctioned' not in diff
print('scope assertions: PASS')
PY
```

Expected: formatting clean and scope assertions pass.

- [ ] **Step 8: Review and commit implementation**

```bash
git diff -- iwmac-designer-import-export/iwmac-designer-reference/AI-BRIEFING.txt
git add iwmac-designer-import-export/iwmac-designer-reference/AI-BRIEFING.txt
git commit -m "docs: require light generated panel backgrounds" \
  -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

Expected: one documentation file committed.

---

### Task 2: Amend and verify PR #2

**Files:**
- No file changes.
- Verify: branch `worktree-ai-briefing-ventilation-9099` and GitHub PR #2.

**Interfaces:**
- Consumes: committed light-background documentation from Task 1 plus already committed spec and plan.
- Produces: updated remote branch and open, mergeable PR #2; no merge.

- [ ] **Step 1: Push branch commits**

```bash
git push origin worktree-ai-briefing-ventilation-9099
```

Expected: design spec, implementation plan, and AI briefing amendment reach existing PR #2.

- [ ] **Step 2: Update PR description**

```bash
gh pr edit 2 --repo Hapnes-dev/tampermonkey-scripts --body-file - <<'EOF'
## Summary
- document sanitized production anatomy from plant 9099 panel `360.001 Ventilasjon`
- distinguish panel display name from exact live inventory name `360.001Ventilasjon`
- require valid same-object `driver_id` and `unit_id`; reject `linked: "true"` and opaque `V01` as classification evidence
- require light backgrounds for every newly generated panel picture
- preserve an existing dark production background only during an explicitly requested edit of that same panel
- keep canonical plant 9099 evidence outside exact-20 MENY totals

## Validation
- `python -m unittest discover -s iwmac-designer-import-export/iwmac-designer-reference/tests -v` (16 passed)
- deterministic light-background contract assertions
- `git diff --check`
- documentation-only scope assertions
- no `.user.js` or userscript version changes

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
```

Expected: PR #2 description includes light-background policy and validation.

- [ ] **Step 3: Verify clean branch and open PR**

```bash
git status --short --branch
gh pr view 2 --repo Hapnes-dev/tampermonkey-scripts \
  --json number,state,url,headRefName,baseRefName,mergeStateStatus,title
```

Expected: clean tracking branch; PR #2 remains `OPEN`, targets `main`, and reports `CLEAN`. Stop without merging.
