# MeadEvil Mentor Map

## Core Files
- `netlify/functions/meadevil-mentor.mjs`: serverless mentor runtime and upstream model integration
- `assets/js/meadevil-mentor.js`: frontend mentor shell and fallback behavior
- `assets/js/app.js`: Brainstorm tab state, mapping, and UI integration if present
- `scripts/brainstorm-stress-test.mjs`: local end-to-end stress test
- `scripts/dev-server.mjs`: local runtime that mounts static app + functions

## Architecture Rules
- live mentor should call a backend or serverless endpoint
- browser code should send a Brainstorm packet and receive structured output
- no API key in browser JS
- fallback is acceptable as a bridge, not as proof that the real backend is healthy

## Good Questions During Triage
- Did the frontend hit the real local/deployed endpoint?
- Did the function return structured JSON or a fallback shell?
- Is JSON repair hiding a deeper upstream response problem?
- Did a config/env issue make the UI appear "fine" while backend truth is broken?
