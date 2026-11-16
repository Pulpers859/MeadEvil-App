# MeadEvil Setup

This is the repo-facing setup guide for the organized project layout.

## Source of truth

- Primary repo path: `C:\Dev\MeadEvilApp`
- Older Desktop copy should be treated as stale unless you explicitly resync it.

## Working layout

- `index.html` keeps the static app entry point at the repo root.
- `assets/` holds browser-facing CSS, JS, and icon files.
- `config/firebase/` holds the example browser config file and the ignored local config override.
- `scripts/dev-server.mjs` serves the static app locally and mounts the Netlify functions.
- `scripts/brainstorm-stress-test.mjs` exercises the mentor flow against the local server.
- `netlify/functions/` remains the serverless runtime surface.
- `docs/HANDOFF.md` is the product and workflow source of truth.

## Local run notes

Start the app with:

```powershell
node scripts/dev-server.mjs
```

Default local URL:

```text
http://127.0.0.1:8910
```

Optional `.env.local` values used here include:

- `MEADEVIL_DEV_PORT`
- `OPENAI_API_KEY`
- Firebase and Firestore bridge environment variables for the Netlify functions

## Deployment environment variables

Set these in the Netlify environment (not in `.env.local`, not in browser JS):

| Variable | Required | Why |
| --- | --- | --- |
| `OPENAI_API_KEY` | yes | Server-side mentor calls. Never expose to the browser. |
| `MENTOR_ALLOWED_ORIGINS` | **yes in production** | Comma-separated origin allowlist, e.g. `https://meadevil.netlify.app`. **When unset the mentor endpoint accepts requests from any origin**, which makes it a free, unmetered proxy billed to `OPENAI_API_KEY`. The function logs a warning on every request while it is unset. |
| `MENTOR_RATE_MAX` | no | Model calls allowed per client address per 5 minutes (default 30). Template and knowledge-base replies do not count. |
| `MENTOR_FUNCTION_BUDGET_MS` | no | Time the mentor function allows itself (default 9000, for Netlify's 10 s limit). Raise only if the site's function limit is higher. |
| `MENTOR_STRUCTURED_EXTRACT` | no | Set to `off` to skip the second, JSON-mode call that reads amounts out of a reply for Send to Build. |
| `RAPT_WEBHOOK_SECRET` | yes if using RAPT | Shared secret for telemetry ingest. Ingest fails closed without it. |
| `RAPT_ALLOW_UNAUTHENTICATED` | no | Explicit opt-out of the ingest secret. Leave unset. |
| `GOOGLE_PROJECT_ID` / `GOOGLE_CLIENT_EMAIL` / `GOOGLE_PRIVATE_KEY` | yes if using RAPT | Firestore service account for the telemetry bridge. |

The mentor endpoint is unauthenticated by design — a static site cannot hold a
secret — so the origin allowlist and the single cheap model in `ALLOWED_MODELS`
and the per-address rate limit are the only real spend controls. Do not widen
them without a reason.

## Tests

```text
npm test             # browser regressions, user journey, end-to-end workflow
npm run test:sync    # two-device cloud sync against a fake Firestore (~3 min)
npm run test:mentor  # mentor function with a stubbed model
npm run test:offline # service worker / no-signal shell
```

The browser suites need the dev server running (`node scripts/dev-server.mjs`).
`.github/workflows/tests.yml` runs them on every push to `main`.

## Firebase config

For direct local HTML use, copy:

```text
config/firebase/meadevil-firebase-config.example.js
```

to:

```text
config/firebase/meadevil-firebase-config.local.js
```

That local override is intentionally ignored by Git.

### Cloud sync: what it is and is not

- Every signed-in device reads and writes ONE shared document
  (`meadevilApp/meadevil-shared`) under anonymous auth. Anyone holding the
  Firebase config can read and write it. Lock it down in Firestore rules (or
  move to per-user documents with real sign-in) before sharing the site widely;
  that is a product decision, not something the client code can fix.
- Sync is a three-way merge against a per-device baseline, not "newest save
  wins". When a device's unsynced batch work cannot be merged it is parked in
  the Vault as "(recovered copy)" rather than dropped.
- `ui`, the brew timer and RAPT fetch bookkeeping stay on the device.
- The document is capped at about 950 KB; past that the pill reports the size
  and the device keeps receiving but stops uploading until data is trimmed.

## Repo notes

- Everyday work should happen in `C:\Dev\MeadEvilApp`.
- Keep Netlify functions in place unless the deployment model changes.
- The app still has no build step, so folder cleanup should stay lightweight and path-safe.
