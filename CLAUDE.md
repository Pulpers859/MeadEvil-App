# MeadEvil Claude Code Memory

## Start Here
- Source-of-truth repo root: `C:\Dev\MeadEvilApp`
- Static app entry point: `index.html`
- Main browser runtime: `assets/js/app.js`
- Mentor backend: `netlify/functions/meadevil-mentor.mjs`
- Default branch: `main`
- Ignore stale copies unless the user explicitly asks:
  - older Desktop copies of MeadEvil

## Minimal Working Rules
- Work from this repo, not stale copies.
- If the repo is clean, run `git fetch --prune` and `git pull --ff-only` before normal edits.
- Push completed repo changes unless the user says not to.
- Treat `.env.local`, Firebase local config files, and API secrets as local-only.
- This app has no build step; keep edits path-safe and deployment-safe.
- Do not casually split `assets/js/app.js` unless there is a real payoff.
- Keep Build as recipe truth, Ferment as active truth, Cellar as post-fermentation truth, and Archive as historical truth.
- Never put API keys in browser JavaScript.

## Context Discipline
- Read this file first, then only the one repo skill and files needed for the task.
- Do not load all docs or large app files by default.
- Prefer targeted searches and small file reads over broad repo sweeps.
- Use `.claude/skills/meadevil-context-compact` when reviving old work or preparing a handoff.
- Use `repomix` only for external full-repo handoffs, not normal local work.

## Skill-First Workflow
- In this repo, treat the repo-local skills as the default operating path, not an optional extra.
- At the start of a fresh session in `C:\Dev\MeadEvilApp`, first apply `meadevil-handoff` unless the task is already deep in one known file.
- If resuming prior work, mixed context, or long threads, apply `meadevil-context-compact` before broader repo exploration.
- For frontend structure, tab workflow, save/load, import/export, or no-build browser-app work, automatically apply `meadevil-static-app`.
- For Brainstorm, Mentor, Netlify function, fallback, API boundary, or local-vs-deployed mentor issues, automatically apply `meadevil-mentor-runtime`.
- If more than one repo skill could apply, prefer the smallest combination that fits the task instead of loading everything.
- Do not wait for the user to explicitly name these skills when the task clearly matches them.

## Repo Skills
- `meadevil-handoff`: repo orientation, stale-copy warnings, branch workflow, hotspots.
- `meadevil-static-app`: no-build app structure, UI/runtime guardrails, tab/workflow integrity.
- `meadevil-mentor-runtime`: Brainstorm and Mentor backend/frontend boundary, fallback logic, Netlify function triage.
- `meadevil-context-compact`: compact summaries, selective context loading, low-token handoffs.

## Read Deeper Only When Needed
- `docs/HANDOFF.md`
- `docs/SETUP.md`
- `netlify/functions/meadevil-mentor.mjs`
- `assets/js/app.js`

## Validation Reality
- Best validation path is local browser testing through `node scripts/dev-server.mjs`.
- Netlify functions and local server behavior matter more than fake build checks.
- Because this is a no-build static app, runtime behavior, persistence, and import/export safety matter more than formal compile steps.
