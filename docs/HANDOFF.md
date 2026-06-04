# MeadEvil Handoff

This is the single source-of-truth handoff for the MeadEvil app.

It consolidates the old split handoff notes into one place and also folds in the mead-development workflow standard that worked well for the Code Blue concept work.

## 1) Project identity

MeadEvil is a static web app for meadmaking, recipe development, fermentation tracking, finishing, and archive/reuse.

Core identity:
- mead-first, not beer-with-honey
- local-first
- drag/drop deployable
- no build step
- mobile-friendly and home-screen friendly
- one app, not split into separate products unless the user explicitly changes direction

The app should feel like MeadEvil, not like a generic recipe app and not like a reskinned beer workflow.

## 2) Current app structure

Current files and roles:
- `index.html` - layout and semantic containers
- `assets/css/styles.css` - visual system, spacing, responsive behavior, button/card treatments
- `assets/js/app.js` - app state, renderers, event binding, tab behavior, persistence, import/export, recipe/batch/archive workflow
- `assets/js/mead-logic.js` - formulas and pure-ish helper logic
- `assets/js/meadevil-mentor.js` - mentor UI / local fallback logic
- `assets/js/firebase-sync.js` - sync layer if present in this build
- `assets/js/firebase-config-loader.js` - loads local or Netlify-served Firebase config into the browser
- `config/firebase/` - example and local-only browser Firebase config helpers
- `netlify/functions/meadevil-mentor.mjs` - server-side mentor path if deployed through Netlify Functions

Do not split `assets/js/app.js` further unless there is a real payoff.
There is no build step here, so unnecessary file splitting can create more fragility than value.

## 3) Current visual direction

The app intentionally moved away from the earlier parchment / illuminated-ledger direction.

Current direction:
- near-black background
- cream text
- purple / crimson accents
- stronger contrast
- sharper headings
- dark, aggressive, poster / stage-flyer energy

The goal is to feel anti-snob and distinct from the earlier beer app while still being readable and practical.

Do not make the UI unreadable just to be edgy.

## 4) Current workflow loop

The app should support the real mead loop end to end:

1. Build the recipe and source bill
2. Plan feed / nutrient strategy
3. Track active fermentation
4. Manage stabilization, backsweetening, bench trials, blending, and packaging in Cellar
5. Archive the batch and recipe so it can be reused, cloned, and improved later

Do not break the recipe -> batch -> archive loop.

## 5) Current tab intent

Current tabs:
- Dash - active batch pulse only
- Build - recipe creation, source bill, design target, source reality, sanity engine
- Ferment - active batch, gravity log, sugar break, step feeding
- Feed - nutrient protocol execution and inherited batch values
- Cellar - stabilization, backsweetening, post-fermentation additions, bench trials, blending, packaging helpers
- Archive - saved recipes and archived batches
- Calcs - compact utility math
- Brainstorm - concept / idea support

Important naming rule:
- the tab must say `Build`, not `Forge`
- `Brainstorm` replaces the older `Riff` naming

## 6) Build tab rules

The Build tab is the recipe source of truth.

Important architecture rule:
- the Source Bill is the source of truth for fermentables and gravity math
- non-fermentable structural additions should not pollute the Source Bill

Build now has three distinct concepts:

### Design target
- theoretical north star
- target OG
- target FG
- target ABV
- sweetness assumption
- traditional-mead-equivalent honey estimate

### Source bill reality
- actual gravity / points from entered fermentable sources
- reflects the real combined source bill
- shows OG delta versus target
- shows top gravity contributors

### Sanity engine
- opinionated warning layer
- should flag mismatches, suspicious inputs, and structural problems

### Structure Additions

Structure Additions should be their own recipe-level array, separate from the Source Bill.

This is for things like:
- botanicals
- citrus
- tea
- oak
- acid
- tannin
- spice
- bench-trial-oriented additions

These should be saved with the recipe but stay out of gravity math.

### Source Bill behavior

Current behavior expectations:
- common source types auto-fill standard PPG defaults
- custom source allows manual PPG override
- honey planning should assume 35 PPG by default
- batch size should not be tied to source PPG

### Yeast / nitrogen source of truth

Build owns:
- yeast
- dry yeast grams
- nitrogen requirement

Feed inherits those values.
Do not duplicate them as editable truth in Feed.

## 7) Feed tab rules

Feed is an execution panel, not a second recipe builder.

Current nutrient protocol labels:
- `Fermaid O (TOSNA 2.0)`
- `Fermaid K / DAP (20%:80%)`
- `Fermaid O / Fermaid K / DAP (Advanced)`
- `Custom`

Current rules:
- preset protocols own their defaults
- cap / ratio controls are editable only in Custom
- Feed should not ask the user to re-enter yeast or nitrogen requirement
- preserve the trust that preset protocols are actually preset

## 8) Ferment section

Ferment is for active batch tracking:
- gravity log
- SG / Brix context
- 1/3 sugar break visibility
- step-feeding support
- active fermentation notes

This section is not for initial recipe construction.

## 9) Cellar section

Cellar is for post-fermentation truth:
- finish path
- stability gate
- two stable SG entries and dates
- pH / temperature fields
- potassium metabisulfite record
- potassium sorbate record
- backsweetening planning
- post-fermentation additions log
- bench-trial / best trial sample support
- blending helper
- packaging helper

Important cellar rule:
- do not stabilize until fermentation is truly complete and gravity is stable
- if backsweetening, stabilize first, then bench trial and sweeten

## 10) Archive behavior

Archive should preserve enough context to:
- remember what worked
- remember what failed
- clone and improve later batches
- support the recipe -> batch -> archive loop

Do not break portability or historical context in archive data.

## 11) Mentor / Brainstorm architecture

Brainstorm should be beginner-friendly on the surface and structured underneath.

The user should be able to speak in plain English about:
- inspiration
- desired drinking experience
- must-have flavors
- flavors or outcomes to avoid
- vibe / emotional target
- process comfort
- risk tolerance
- serving context
- batch constraints

The system should infer the expert structure.

### MeadEvil Mentor

Mentor intent:
- blunt
- brutally honest
- highly practical
- educational, not fluffy
- willing to push back when a concept is weak

Mentor should:
- explain tradeoffs
- identify what is missing
- call out risks honestly
- translate vague beginner ideas into brewable architecture
- provide structured outputs that can map into Build

Planned coach modes:
- Scout - explore possible directions
- Pushback - sharpen or challenge the concept
- Forge - convert concept into structured build guidance

### Mentor implementation rule

Do not put an API key in browser JavaScript.

The live mentor should call a backend or serverless endpoint.
Frontend should only send a Brainstorm packet and receive structured output.

If the live endpoint is missing or misconfigured, fallback logic may exist locally, but that should be treated as a bridge, not the final architecture.

Likely Netlify path if used:
- `/.netlify/functions/meadevil-mentor`

## 12) Meadmaking workflow standard

This is the recipe-development workflow style the user liked.

### Start with the sensory target

Do not jump straight into a recipe.
Start by asking what the mead should feel like in the glass:
- what is the concept or inspiration?
- what should it feel like?
- what should it not become?
- what is the vibe or emotional target?
- what is the drinking experience supposed to be?

### Offer multiple directions

Do not force a single answer too early.
Usually give 2 to 3 concept directions, then explain which is strongest and why the others are riskier.

### Push on structure

Explain:
- what is carrying the concept
- what is only support
- what is missing
- what adds tension, brightness, lift, or structure
- what might turn the mead soft, muddled, jammy, perfumey, or gimmicky

### Refine ingredients after the concept is coherent

Do not start with ingredient amounts.
First decide:
- honey role
- fruit role
- botanical role
- acidity / tannin / structure strategy
- finish direction
- likely yeast fit

### Build the exact batch

Once the concept is locked:
- scale to the requested batch size
- assign primary vs secondary vs finishing roles
- give nutrient recommendations with reasoning
- explain process risks honestly
- include bench-trial logic when relevant

### Then make the recipe sheet

When the recipe is coherent, produce:
- a clean printable recipe
- practical tables
- start volume and water estimate
- fermentation schedule
- secondary / finishing steps
- bench-trial quick reference
- stabilization guidance if relevant

### Tone standard

The user wants:
- brutally honest
- direct
- practical
- sensory and process driven
- real meadmaker-style critique
- not generic encouragement

Do not be soft when a choice weakens the concept.
Do not flatter bad structure.

## 13) Code Blue reference state

The Code Blue workflow is the best example of how the user likes recipe decisions made.

### Core concept

Code Blue was a 1.5 gallon blueberry botanical mead intended to feel:
- cold
- dark-fruited
- controlled
- lifted
- slightly eerie
- polished, not jammy

The key design move was to honor a meaningful ingredient while still keeping the mead bright and controlled.

### Honey logic

Final honey bill:
- 2.0 lb clove honey
- 2.5 lb clean wildflower honey

The clove honey was meaningful and should be honored, but the rest of the bill had to keep the mead from becoming muddy or too warm.

### Fruit logic

Final fruit:
- 3.25 lb blueberries
- frozen / thawed and lightly crushed
- not pureed

### Pectic enzyme

Use pectic enzyme.

Best practice:
- add it with the crushed / thawed blueberries in the must
- ideally give it 6 to 12 hours head start before pitching yeast
- if timing is not perfect, still use it rather than skipping it

### Yeast preference

Best fit ranking:
- 71B
- D47
- K1V-1116

### Nutrients

Final recommendation:
- Fermaid O only
- total 7.5 g
- 2.5 g at 24 hours
- 2.5 g at 48 hours
- 2.5 g at 72 hours or around the 1/3 sugar break

### Secondary / finishing logic

Final finishing direction:
- juniper in secondary
- lemon zest in secondary
- elderflower extract as a bench-trial finishing adjustment
- white tea only if needed for additional finish structure

Important principle:
- elderflower extract is a finishing tool, not something to dump blindly into the full batch
- bench trial in 100 mL samples first

Suggested elderflower extract trial range:
- 0.15 mL / 100 mL
- 0.30 mL / 100 mL
- 0.45 mL / 100 mL

### Stabilization

Do not stabilize until fermentation is complete and gravity is stable.

If finishing dry and still with no backsweetening:
- sorbate is not automatically required just to package a stable mead

If backsweetening:
- stabilize first
- then bench trial and sweeten

## 14) Current implementation reality

Be honest about what is real and what is still a bridge.

What is real right now:
- the frontend mentor shell exists
- Brainstorm is meant to be more guided and beginner-friendly
- structure additions are a defined concept direction
- the app is intended to keep Build as recipe truth
- the app is intended to keep the mentor safe and server-side

What may still be incomplete:
- the live mentor backend may not yet be fully implemented or wired correctly
- if the UI shows a fallback message, treat that as a sign the endpoint is missing or not returning clean JSON

## 15) Guardrails for future work

Do not:
- put API keys in browser JS
- dump mentor output into one giant notes field and call it integrated
- force beginners to define expert sensory architecture too early
- let the mentor silently overwrite recipe data
- pollute the Source Bill with non-fermentable additions
- break save/load/import/export to add features
- casually split `app.js` without a real payoff

Do:
- keep mentor output structured
- keep user edits authoritative
- let Brainstorm teach, not just collect
- keep Build as recipe truth
- keep Ferment as active truth
- keep Cellar as post-fermentation truth
- keep Archive as memory of both recipes and outcomes

## 16) Highest-value future improvements

If work continues, the best next improvements are:
1. improve fruit / juice / concentrate contribution logic
2. make backsweetening and finishing math more explicit about estimates versus exact values
3. expand bench-trial support for acid and tannin stock-solution workflows
4. continue tightening mobile spacing and condensed layouts where rows still feel wasteful
5. finish the real live mentor backend if it is still only a shell

## 17) Final status judgment

The app should be treated as a strong, usable v1 that is worth continuing from.

The next round of changes should come from real use and targeted refinement, not speculative feature bloat.

If something weak shows up, fix the root cause instead of papering over it.
