---
name: meadevil-static-app
description: Work safely inside the MeadEvil no-build static app without breaking the recipe workflow, browser runtime, persistence, or mobile usability. Use when editing `index.html`, `assets/css/styles.css`, `assets/js/app.js`, related browser JS helpers, tab structure, or local runtime behavior.
---

# MeadEvil Static App

Use this skill for the core MeadEvil browser app with the assumption that it is a no-build static app and that runtime safety matters more than architectural tidiness.

## Workflow

1. Read `references/static-app-map.md`.
2. Identify the narrowest surface involved:
   - shell/layout in `index.html`
   - visual system in `assets/css/styles.css`
   - app workflow/state in `assets/js/app.js`
   - formula helpers in `assets/js/mead-logic.js`
   - sync/config helpers if the bug touches Firebase or shared data
3. Map the requested change to the real workflow it affects:
   - Build
   - Feed
   - Ferment
   - Cellar
   - Archive
   - Calcs
   - Brainstorm
4. Protect the core loop while editing:
   - recipe creation
   - active batch tracking
   - cellar finishing
   - archive reuse
5. Validate with the lightest realistic check:
   - local browser behavior
   - state save/load
   - import/export if relevant
   - mobile layout if UI changed

## Rules

- Do not add a build system just to make the file tree look cleaner.
- Do not split `assets/js/app.js` casually.
- Keep Build as the recipe source of truth.
- Do not let non-fermentable Structure Additions pollute Source Bill gravity math.
- Preserve drag/drop deployability and path safety.
- Prefer focused edits over broad style churn.

## Common Uses

- "Update the Build tab."
- "Fix this persistence or archive issue."
- "Tighten mobile spacing."
- "Review whether this UI change breaks the recipe -> batch -> archive loop."

## References

- Read `references/static-app-map.md`.
