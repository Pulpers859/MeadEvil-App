# MeadEvil UI/UX Foundation

## Purpose

This note applies the shared UI/UX evaluation playbook specifically to MeadEvil so future redesign or polish work starts from the app's real product needs.

## Product Snapshot

- **Product purpose**: Help a meadmaker design recipes, execute fermentation, manage finishing decisions, and preserve reusable history.
- **Primary user**: A real brewer working quickly on desktop or phone, often mid-process, often bouncing between planning and execution.
- **Critical workflows**:
  1. Build a coherent recipe
  2. Translate that recipe into a real source bill
  3. Track fermentation and feed timing
  4. Make finishing and packaging decisions
  5. Reuse saved work from Vault
- **Platform**: Static web app with strong mobile importance and desktop utility
- **Implementation stack**: No-build `index.html` + `assets/css/styles.css` + `assets/js/app.js`
- **Current identity worth preserving**:
  - dark anti-snob mead tone
  - sharp headline typography
  - cream-on-near-black readability
  - purple/crimson accent language
  - practical tools over marketing polish

## Dominant Design Needs

Rank these first when deciding whether external UI/UX resources should influence the app:

1. **Design-system structure**
   - stronger hierarchy
   - clearer control grouping
   - more consistent spacing and active states
2. **Quality assurance**
   - desktop/mobile readability
   - empty/error/selected states
   - sticky and dense surfaces that stay understandable
3. **Component behavior**
   - navigation clarity
   - progressive disclosure
   - compact but readable data panels
4. **Visual-direction research**
   - only when MeadEvil starts to feel generic, muddy, or too dense

## Current UI Risks To Watch

- Navigation reading like a single strip instead of distinct destinations
- Dense cards with weak internal hierarchy
- Too many labels competing at the same visual weight
- Dark-theme polish reducing clarity instead of improving it
- Desktop layouts that look broad but do not guide the eye cleanly
- Mobile sections becoming long stacks of equally loud boxes

## MeadEvil Design Rules

- Preserve the MeadEvil tone, but do not let attitude beat comprehension.
- Treat active states as first-class information, not a subtle afterthought.
- Major destinations must look like separate controls at a glance.
- Use progressive disclosure to manage density instead of dumping every field open.
- Prefer a few strong hierarchy moves over many decorative ones.
- Do not import another product's layout language wholesale.
- Do not add design-system complexity that the no-build stack cannot sustain.

## Resource Decisions For MeadEvil

These are the default outcomes unless a future task reveals a stronger need:

- **Builder.io skills**: `Adapt`
  Use for workflow and research-process ideas, not as a permanent pile of overlapping UI instructions.
- **UI UX Pro Max**: `Reference`
  Useful for style exploration and critique prompts, but not a design authority.
- **21st.dev**: `Reference`
  Good for selective web-component inspiration. Do not paste patterns in blindly.
- **UX Components**: `Adapt`
  Strong fit for component-behavior reasoning, state coverage, and accessibility checks.
- **Refero**: `Reference`
  Use for flow and hierarchy research, especially settings, dashboards, archive patterns, and dense tools.

## When To Trigger the UI/UX Resource-Eval Skill

Use the repo-local `ui-ux-resource-eval` skill when work involves:

- deciding whether an outside component or design resource should influence MeadEvil
- redesign planning across multiple surfaces
- choosing a design-system direction
- comparing references before a bigger UI pass
- adding permanent design-process guidance for future agents

Do not use it for every spacing tweak or one-off CSS cleanup.

## Navigation-Specific Guardrails

When changing the main tab bar:

- each destination must read as its own control
- the active tab must be obvious in under one second
- inactive tabs still need visible boundaries
- desktop and mobile both matter
- added metadata must support scanning, not add noise
- `Build`, `Ferment`, `Feed`, `Finish`, `Vault`, and `Brainstorm` remain the source-of-truth names
