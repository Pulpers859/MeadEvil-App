---
name: meadevil-handoff
description: Orient Codex to the real MeadEvil repo, stale-copy traps, main-only git workflow, and high-risk app hotspots. Use at the start of a MeadEvil task, when preparing a handoff summary, or when a session needs to rebuild the repo's operating rules before editing.
---

# MeadEvil Handoff

Use this skill to rebuild the minimum correct context for MeadEvil before coding or handing work to another session.

## Workflow

1. Confirm the source-of-truth repo, current branch, repo cleanliness, remote config, and ahead/behind state.
2. Read `references/handoff-map.md`.
3. Explicitly call out stale-copy risk if the task mentions Desktop or older repo copies.
4. State the repo's working assumptions before proceeding:
   - work from `C:\Dev\MeadEvilApp`
   - normal git work happens only on `main`
   - do not create side branches, worktrees, or pull requests unless the user explicitly asks
   - the app has no build step
   - `index.html` is the root shell
   - `assets/js/app.js` is a major hotspot and should not be split casually
   - Netlify functions remain the live backend surface
   - every completed code or instruction change must be committed and pushed to `origin/main`
5. If the task mentions prior work by another AI agent, another machine, another terminal, or another conversation, perform an external-agent reconciliation pass before making new edits, rebases, resets, merges, or sync claims:
   - inspect any outside artifact the user provides, such as a transcript, chat export, screenshot, commit list, or claimed fix summary
   - compare the claimed changes against the current local files, local git history, and the current `main` branch on GitHub
   - tell the user whether each claimed change is present, missing, partially landed, or overwritten
   - only then decide whether to pull, rebase, merge, patch missing work, or leave newer work intact
6. Summarize risks in the order that matters for this app:
   - runtime breakage in the browser
   - recipe -> batch -> archive workflow integrity
   - Brainstorm / Mentor safety and backend boundary correctness
   - persistence and import/export safety
   - mobile/readability regressions
   - maintainability

## Handoff Format

When preparing a handoff or orientation note, include:

1. repo root
2. current branch and status
3. remote sync state
4. stale-copy warnings
5. likely hotspots for the current task
6. what was validated vs not validated

## Rules

- Never treat an older Desktop copy as source of truth unless the user explicitly says so.
- Keep normal repo work on `main`, and always commit and push completed code or instruction changes directly to `main`.
- Never create side branches, worktrees, or pull requests unless the user explicitly asks.
- Do not create a build step just to tidy the architecture.
- Do not move secrets into browser JS.
- Preserve the mead-first workflow and the Build -> Ferment/Feed -> Cellar -> Archive loop.
- If outside-agent work is part of the context, do not claim the repo is fully assessed or in sync until the reconciliation pass is complete.

## References

- Read `references/handoff-map.md` first.
- Use `repomix` only when an external full-repo handoff is actually needed.
