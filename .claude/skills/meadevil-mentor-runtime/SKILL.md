---
name: meadevil-mentor-runtime
description: Debug and evolve MeadEvil Brainstorm and Mentor behavior without breaking the backend boundary, structured outputs, or fallback safety. Use when working on `netlify/functions/meadevil-mentor.mjs`, Brainstorm UI wiring, local stress tests, deployed mentor failures, or API/runtime issues around the mentor flow.
---

# MeadEvil Mentor Runtime

Use this skill for MeadEvil's Brainstorm and Mentor stack with the assumption that the live mentor belongs on the backend/serverless side and that frontend fallback behavior is only a bridge.

## Workflow

1. Read `references/mentor-map.md`.
2. Collect the raw symptom first:
   - user-visible Brainstorm behavior
   - frontend console error
   - local function response
   - deployed function response
   - stress-test output
3. Map the issue to the correct layer:
   - Brainstorm UI packet creation
   - browser request path
   - local server wiring
   - Netlify function behavior
   - upstream model/API failure
   - JSON repair or structured-output parsing
   - fallback behavior masking a real backend failure
4. Prefer fixes in this order:
   - restore backend truth and structured outputs
   - keep the frontend honest about failure states
   - keep fallback logic narrow and explicit
5. Validate with the closest realistic path:
   - `node scripts/dev-server.mjs`
   - `node scripts/brainstorm-stress-test.mjs`
   - local browser Brainstorm flow
   - deployed Netlify function only if needed

## Rules

- Never put API keys in browser JavaScript.
- Treat frontend fallback logic as a bridge, not the final architecture.
- Keep mentor output structured enough to map into Build safely.
- Do not silently overwrite user-edited recipe data with mentor output.
- Be explicit about whether a failure is frontend, function, or upstream API.

## Common Uses

- "Why is the mentor falling back locally?"
- "Fix this Netlify mentor error."
- "Review whether this Brainstorm output is structured enough to map into Build."
- "Check whether the local stress test is exercising the real backend."

## References

- Read `references/mentor-map.md`.
