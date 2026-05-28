# MeadEvil Repo Handoff

This file is the repo-facing operating handoff for MeadEvil. It complements, rather than replaces, [HANDOFF.md](/C:/Users/Patrick's%20Computer/OneDrive%20-%20WV%20School%20of%20Osteopathic%20Medicine/Desktop/MeadEvilApp/HANDOFF.md:1), which contains the deeper product and workflow rules.

## Project Identity
- Project name: `MeadEvilApp`
- Project type: `web app`
- Source-of-truth repo path: `C:\Dev\MeadEvilApp`
- Stale/old copies to ignore if applicable: `C:\Users\Patrick's Computer\OneDrive - WV School of Osteopathic Medicine\Desktop\MeadEvilApp` after migration/bootstrap
- Primary target for normal work if multiple surfaces exist: `main app first, with Netlify functions as supporting surface`
- GitHub intent/status: `remote already exists; local repo still needs migration/bootstrap and attachment`
- GitHub remote: `https://github.com/Pulpers859/MeadEvil-App.git`

## Repo State
- Stable branch: `main`
- Working branch: `dev`
- Expected default branch for normal work: `dev`
- Sync-first rule: `Before normal work, fetch from the remote first. If the working tree is clean and the active branch tracks the expected upstream, pull with --ff-only before editing. If local changes exist, fetch and reconcile instead of blindly pulling.`
- Current reality: `Git is not set up yet in the current project folder. The project should be migrated to C:\Dev\MeadEvilApp and bootstrapped there before normal feature work.`
- If Git is not set up yet for this project, the agent should bootstrap it before doing major feature work.

## If No Git Exists Yet
If `git rev-parse --is-inside-work-tree` fails in the real project root, the agent should help set up the repo using this standard:
1. confirm the real project root
2. migrate the project to `C:\Dev\MeadEvilApp` if the current location is a weak source of truth
3. initialize local Git
4. create a focused `.gitignore`
5. create `.gitattributes` enforcing LF for code files
6. set repo-local config:
   - `core.autocrlf=false`
   - `core.eol=lf`
   - `pull.ff=only`
   - `fetch.prune=true`
7. add repo-local aliases:
   - `git st` -> `status -sb`
   - `git lg` -> `log --oneline --graph --decorate --all --date=short`
8. create the initial commit
9. run a secret scan and remove any live credentials from tracked files before connecting/pushing GitHub
10. connect the GitHub remote if I want one
11. push `main`
12. create and push `dev`
13. add a local hook blocking direct commits to `main`
14. create a dedicated PowerShell shortcut for this project

The GitHub remote is known for this project. The agent should finish local bootstrap first, then attach `origin` to `https://github.com/Pulpers859/MeadEvil-App.git`, inspect whether the remote already contains placeholder history, and reconcile carefully before the first push.

## PowerShell / Terminal Standard
- Do not globally pin every PowerShell session to this project.
- A dedicated shortcut should exist:
  - `MeadEvilApp PowerShell`
- That shortcut should open directly in the source-of-truth repo path.
- Avoid fragile startup command strings if the path contains apostrophes or quoting hazards.

## How The Agent Should Operate
- Inspect before assuming.
- Work in the source-of-truth repo only.
- Sync from GitHub before normal work so the local repo is not stale.
- Fix root causes, not surface symptoms.
- Be honest and direct.
- Prefer architecture/data-flow fixes over hacks.
- Do not use brittle hardcoded special cases or band-aid fixes unless you explicitly explain why a deeper fix is not practical.
- Be proactive: inspect, diagnose, edit code directly, verify, and then audit nearby weaknesses.
- Do not stop at the first fix if adjacent code is obviously fragile.
- Tell me clearly what is evidence-backed, proven, inferred, or heuristic.
- If validation, linting, or review logic is too rigid and rejects good output, improve the rule when appropriate instead of dumbing down the product.
- Do not silently tolerate poor architecture if it is now a maintenance risk.
- Handle Git operations when appropriate.
- Keep normal work on `dev`, not `main`.
- Before editing on an existing repo, run a fetch and check ahead/behind state; if clean, pull the tracked branch with `--ff-only`.
- Audit adjacent risks after making fixes.
- Run the checks that are realistically available in the current environment.
- Clearly distinguish evidence-backed logic from heuristics.
- Treat secrets as local-only by default: use tracked example files and ignored real config files whenever possible.

## Communication Style
- Warm, collaborative, calm, disciplined
- High-effort and thoughtful
- Short progress updates while working
- Clear reasoning, no fluff, no fake certainty
- If the agent misses something, it should own it directly

## Post-Fix Audit Standard
After making changes, the agent should do another harsh pass focused on:
- root-cause completeness
- adjacent fragility
- architecture quality
- validation or rule correctness
- progression / flow coherence where relevant
- silent failure risk
- wasted retries / wasted cost / wasted work
- maintainability

## What The User Wants By Default
- The user describes the problem in chat.
- The agent syncs from the tracked remote branch first so local files are current before investigation or edits.
- The agent investigates directly.
- The agent makes code changes directly.
- The agent audits adjacent risks.
- The agent runs local checks where possible.
- The agent handles Git steps when appropriate.
- The user should not need to babysit PowerShell, Git, or GitHub for normal work.

## Before Starting Any New Task
The agent should confirm:
1. current repo path
2. current branch
3. repo status cleanliness
4. remote configuration
5. whether the local branch is behind the remote and needs fetch/pull
6. whether stale copies exist elsewhere
7. whether the active folder is truly the source of truth

## Architecture / Product Notes
- Main product purpose: `Static meadmaking web app for recipe development, fermentation tracking, cellar decisions, archive/reuse, and brainstorm/mentor support.`
- Key modules or directories: `index.html`, `styles.css`, `app.js`, `mead-logic.js`, `meadevil-mentor.js`, `firebase-sync.js`, `netlify/functions/`
- Known fragile areas: `app.js` is large and central, `recipe -> batch -> archive data flow must stay coherent`, `Build/Feed ownership boundaries are easy to blur`, `mentor browser fallback should not become the long-term architecture`, `cloud sync merge behavior can silently drift if local/cloud precedence rules are changed casually`
- Important evidence/product constraints: `no build step`, `mobile-friendly and home-screen friendly`, `preserve the recipe -> batch -> archive loop`, `Build is the recipe source of truth`, `Source Bill owns gravity math`, `Structure Additions stay out of gravity math`, `Build owns yeast and nitrogen requirement`, `Feed inherits rather than duplicates those fields`, `do not put API keys in browser JavaScript`, `tab naming must keep Build and Brainstorm`
- Runtime environments that matter: `browser`, `mobile browser / home-screen install`, `Netlify functions`

## Git / Release Notes
- Preferred everyday flow:
  - `git st`
  - `git diff`
  - `git add .`
  - `git commit -m "..."`
  - `git push`
- Preferred promotion flow from `dev` to `main`:
  - `git checkout main`
  - `git pull --ff-only`
  - `git merge --ff-only dev`
  - `git push`
  - `git checkout dev`

## Project-Specific Instructions For The Next Agent
```text
Project: MeadEvilApp
Active repo path: C:\Dev\MeadEvilApp
GitHub remote: https://github.com/Pulpers859/MeadEvil-App.git
Stable branch: main
Working branch: dev

Important:
- Treat C:\Dev\MeadEvilApp as the source of truth after migration/bootstrap.
- Until that migration happens, the current working copy lives at C:\Users\Patrick's Computer\OneDrive - WV School of Osteopathic Medicine\Desktop\MeadEvilApp and should be treated as a temporary source, not the long-term canonical repo.
- Do not work in stale copies unless explicitly asked.
- If Git is not already set up, bootstrap it using the repo standard in this file before major feature work.
- Use the standard workflow: investigate directly, fix root causes, audit adjacent risks, run checks, and handle Git when appropriate.
- Before starting normal work, fetch from origin and sync the active branch first when the working tree is clean. If the repo is dirty, fetch and reconcile instead of pulling blindly.
- If multiple surfaces exist, prioritize the main app first and treat Netlify functions as supporting infrastructure.
- The GitHub remote already exists at https://github.com/Pulpers859/MeadEvil-App.git. After local bootstrap, verify whether the remote has existing commits before pushing, so placeholder history is not overwritten casually.
- Cross-check product behavior and architectural rules against HANDOFF.md before changing workflow-heavy logic.
```
