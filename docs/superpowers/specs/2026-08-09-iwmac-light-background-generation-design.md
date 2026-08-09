# IWMAC Light-Background Generation Design

## Goal

Make light backgrounds mandatory for every newly generated IWMAC Designer panel picture while preserving an existing dark production background only when the user explicitly asks to edit that same panel.

## Scope

Modify `iwmac-designer-import-export/iwmac-designer-reference/AI-BRIEFING.txt` only for implementation. This is documentation guidance, not userscript behavior.

No `.user.js` files, userscript versions, production examples, reference JSON, or runtime behavior will change.

## Rules

- Every newly generated canvas or background artwork must use a light base: white, off-white, or light grey.
- Dark colors may remain on bounded foreground elements such as controls, setpoint boxes, pipes, borders, labels, and status indicators. They must not dominate the canvas or background artwork.
- Remove the current sanctioned dark Maskin-generation exception. `maskin-dark-style-example.png` may remain historical/reference evidence, but it is not a generation target.
- A dark background from an existing production panel may be preserved only when the user explicitly requests an edit to that same panel. The AI must not introduce, expand, or select dark styling during that edit.
- A reference image, trace, or existing plant style must not cause a newly generated panel to use a dark background.
- Generated output self-check must explicitly verify light-background compliance and the narrow same-panel preservation exception.

## Documentation Changes

Update the main background-artwork rule to say generated backgrounds are always light. Update Maskin guidance to make the light skin the only generation skin and describe dark reference artwork as preservation-only. Add a self-check item covering both generation and explicit existing-panel edits.

## Validation

- Review the exact diff and confirm only `AI-BRIEFING.txt` changes during implementation.
- Run `git diff --check`.
- Run the existing IWMAC Designer reference test suite.
- Search added lines for contradictory permission to generate dark backgrounds.
- Confirm no `.user.js` or `@version` changes.
- Push the implementation amendment to existing PR #2.
- Do not merge without fresh action-time approval.
