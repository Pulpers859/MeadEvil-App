# MeadEvilApp

MeadEvilApp is a no-build static web app for recipe design, fermentation tracking, cellar decisions, archive reuse, and brainstorm support for meadmaking.

## Folder map

- `index.html` - app shell
- `assets/css/` - styles
- `assets/js/` - browser runtime code
- `assets/icons/` - install and favicon assets
- `config/firebase/` - local browser Firebase config helpers
- `netlify/functions/` - serverless endpoints
- `scripts/` - local dev and stress-test scripts
- `docs/` - product and setup notes

## Start locally

Run:

```powershell
node scripts/dev-server.mjs
```

Then open `http://127.0.0.1:8910`.

## Docs

- Product behavior and workflow rules: `docs/HANDOFF.md`
- Repo/setup notes: `docs/SETUP.md`
