# MeadEvil Compact Map

## Smallest Useful Load Order
1. `CLAUDE.md`
2. one repo skill
3. one of:
   - `docs/HANDOFF.md` for product rules
   - `docs/SETUP.md` for repo layout and run info
   - a single target source file

## Choose The Next Skill
- orientation / repo rules / stale-copy warning -> `meadevil-handoff`
- UI, tabs, layout, app runtime, persistence, import/export -> `meadevil-static-app`
- Brainstorm, mentor endpoint, JSON repair, fallback, API boundary -> `meadevil-mentor-runtime`

## Token Traps
- reading all of `assets/js/app.js` when only one tab or helper is relevant
- re-reading `docs/HANDOFF.md` in full when only one workflow rule matters
- loading both frontend and backend mentor files before locating the actual symptom
