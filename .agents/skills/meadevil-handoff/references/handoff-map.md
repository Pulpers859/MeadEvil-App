# MeadEvil Handoff Map

## Source Of Truth
- Repo root: `C:\Dev\MeadEvilApp`
- Local start command: `node scripts/dev-server.mjs`
- Default local URL: `http://127.0.0.1:8910`

## Primary Docs
- `README.md`: quick folder map and local start
- `docs/SETUP.md`: repo layout, stale-copy warning, env notes
- `docs/HANDOFF.md`: product identity, workflow rules, mentor architecture, and guardrails

## File Hotspots
- `index.html`: shell structure and tab containers
- `assets/css/styles.css`: visual system and responsive behavior
- `assets/js/app.js`: main state, renderers, event binding, persistence, recipe/batch/archive workflow
- `assets/js/mead-logic.js`: formula and helper logic
- `assets/js/meadevil-mentor.js`: frontend mentor shell or fallback behavior
- `assets/js/firebase-sync.js`: sync layer if used in this build
- `assets/js/firebase-config-loader.js`: browser config loader
- `netlify/functions/meadevil-mentor.mjs`: live mentor backend
- `scripts/dev-server.mjs`: local static + function dev server
- `scripts/brainstorm-stress-test.mjs`: mentor stress-test path

## High-Risk Areas
- breaking the no-build browser runtime through unnecessary file splitting
- polluting the Source Bill with non-fermentable additions
- breaking save/load/import/export
- making mobile spacing worse while chasing edgy styling
- leaking API keys or pushing mentor logic client-side
- treating fallback mentor behavior as the final architecture
