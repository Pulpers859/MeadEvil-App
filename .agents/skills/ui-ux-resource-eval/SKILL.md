---
name: ui-ux-resource-eval
description: Evaluate external UI/UX resources, component libraries, design systems, visual reference sites, and design-oriented agent skills for MeadEvil using the repo's playbook and app-specific foundation note. Use when deciding whether outside UI/UX repos or websites should influence the product, or when planning a redesign that depends on external reference sources.
---

# UI/UX Resource Evaluation

Use this skill to evaluate outside UI/UX resources through MeadEvil's actual needs instead of inheriting another project's conclusions.

## Workflow

1. Read `docs/AI_UI_UX_RESOURCE_EVALUATION_PLAYBOOK.md`.
2. Read `docs/MEADEVIL_UI_UX_FOUNDATION.md`.
3. Inspect the actual app before making recommendations.
4. Identify:
   - product purpose
   - primary users
   - critical workflows
   - target platforms
   - implementation stack
   - current design maturity
   - current UI/UX weaknesses
   - important technical or accessibility constraints
5. Classify the app's dominant need before judging the resources:
   - product-flow research
   - visual-direction research
   - component behavior
   - ready-made implementation
   - design-system structure
   - agent efficiency
   - quality assurance
6. Assess each resource with the playbook and assign one outcome:
   - `Adopt`
   - `Adapt`
   - `Reference`
   - `Skip`
7. Recommend the smallest useful system with minimal overlap.
8. If a repo-local skill or guidance file should be added, keep it specific to MeadEvil's actual workflows.

## Rules

- Use the playbook as a neutral framework, not a preset recommendation.
- Do not assume MeadEvil should inherit another app's style.
- Do not recommend installing everything.
- Distinguish clearly between:
  - visual research
  - component-behavior guidance
  - implementation-ready code
  - agent-workflow improvements
- Keep routine UI fixes routine. Do not trigger this workflow unless the task is actually about outside UI/UX influence or design-direction decisions.

## Expected Output

Return:

1. MeadEvil's highest-priority design needs
2. a candid assessment of each resource
3. an `Adopt / Adapt / Reference / Skip` outcome for each resource
4. the specific situations where the selected resources should be used
5. the smallest recommended combined workflow
