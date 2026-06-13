# MeadEvil Static App Map

## Core Runtime Files
- `index.html`: app shell, tab containers, semantic structure
- `assets/css/styles.css`: theme, spacing, cards, buttons, responsive behavior
- `assets/js/app.js`: state, rendering, events, persistence, import/export, recipe/batch/archive flow
- `assets/js/mead-logic.js`: math and formula helpers
- `assets/js/firebase-sync.js`: optional sync layer
- `assets/js/firebase-config-loader.js`: browser config loader

## Workflow Rules To Protect
- Build is recipe truth
- Feed executes nutrient strategy and inherits recipe truth
- Ferment tracks active batch reality
- Cellar handles stabilization, finishing, trials, blending, packaging
- Archive preserves portable historical context
- Brainstorm helps ideation but should not silently overwrite authoritative recipe data

## Visual Direction
- near-black background
- cream text
- purple/crimson accents
- sharper headings
- readable before edgy

## Frequent Failure Patterns
- UI edits that reduce readability or mobile fit
- save/load regressions after adding new fields
- import/export drift when data shape changes
- mixing recipe design data with active-batch or cellar-only truth
