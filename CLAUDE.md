# MeadEvil Claude Code Memory

## Start Here
- Source-of-truth repo root: `C:\Dev\MeadEvilApp`
- Static app entry point: `index.html`
- Main browser runtime: `assets/js/app.js`
- Mentor backend: `netlify/functions/meadevil-mentor.mjs`
- Default branch: `main`
- Git workflow default: stay on `main`, commit and push every completed code or instruction change directly to `main`, and never create side branches or pull requests unless the user explicitly asks.
- Ignore stale copies unless the user explicitly asks:
  - older Desktop copies of MeadEvil

## Minimal Working Rules
- Work from this repo, not stale copies.
- If the repo is clean, run `git fetch --prune` and `git pull --ff-only` before normal edits.
- Do all normal repo work on `main`; do not create or use side branches, worktrees, or pull requests unless the user explicitly asks.
- Every completed code or instruction change is required to be committed and pushed to the GitHub repo so the remote stays current across machines and agents.
- Do not leave completed local code changes uncommitted or unpushed, even if the edits were made by another agent with repo access.
- Treat `.env.local`, Firebase local config files, and API secrets as local-only.
- This app has no build step; keep edits path-safe and deployment-safe.
- Do not casually split `assets/js/app.js` unless there is a real payoff.
- Keep Build as recipe truth, Ferment as active truth, Cellar as post-fermentation truth, and Archive as historical truth.
- Never put API keys in browser JavaScript.
- If prior work by another AI agent, machine, terminal, or conversation is mentioned, do not assume the current diff or latest visible commit tells the full story.
- Before making new edits, rebases, resets, merges, or sync claims in that situation, perform an external-agent reconciliation pass:
  1. Inspect any outside artifact the user provides, such as a transcript, chat export, screenshot, commit list, or claimed fix summary.
  2. Compare what that agent claimed to change against the current local files, the local git history, and the current `main` branch on GitHub.
  3. Tell the user plainly whether each claimed change is present, missing, partially landed, or overwritten.
  4. Only after that comparison should you decide whether to pull, rebase, merge, patch missing work, or leave newer work intact.
- Do not claim the repo is fully assessed or in sync until that reconciliation pass is complete whenever outside-agent work is part of the context.

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
- `meadevil-handoff`: repo orientation, stale-copy warnings, main-only git workflow, hotspots.
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
