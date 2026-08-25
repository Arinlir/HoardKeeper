# Load-time fix: before / after

`src/App.jsx` used to be a single 12,500-line file that shipped every view (Collection,
Sets, Decks, Glossary, Life Counter, Analytics/charts) and every library (including
`recharts`, the heaviest dependency) in one eager bundle, on every visit, regardless of
what actually got opened. It's now split into `src/lib/`, `src/components/ui/`, and
`src/features/**`, with the less-visited views/libraries loaded on demand via
`React.lazy()` and dynamic `import()`.

## Before (single-file App.jsx, everything eager)

- `dist/assets/index-*.js` — 845.00 kB (gzip: 235.09 kB) — one bundle: every view, every
  modal, `recharts`, `papaparse`, all of it, on every load.

## After (split into modules, lazy-loaded per view/library)

| Chunk | Size (gzip) | Loads when |
|---|---|---|
| `index-*.js` | 138.20 kB (38.41 kB) | always — shell + boot/auth gate + Collection view |
| `DecksView-*.js` | 40.24 kB (11.79 kB) | first click on "Decks" |
| `GlossaryView-*.js` | 21.88 kB (7.90 kB) | first click on "Glossary" |
| `SetsView-*.js` | 20.03 kB (5.59 kB) | first click on "Sets" |
| `LifeCounterView-*.js` | 11.49 kB (3.86 kB) | first click on "Life" |
| `Analytics-*.js` | 8.61 kB (2.97 kB) | first time the chart panel is opened |
| `ImportModal-*.js` | 12.54 kB (4.79 kB) | first time Import is opened |
| `SettingsModal-*.js` | 12.87 kB (3.44 kB) | first time Settings is opened |
| `papaparse-*.js` | 19.88 kB (7.43 kB) | first CSV import or export |
| `recharts-*.js` | 563.29 kB (157.97 kB) | only if charts are ever opened |

Numbers are from an actual `npm run build`, not an estimate — reproduce with
`npm run build` and read `dist/assets/*.js` sizes yourself.

## After the visual + accessibility redesign (Phase 3)

The redesign pass (design tokens, keyboard navigation, focus states, ARIA labels, form
labeling) touched components across every feature area but didn't change the
code-splitting boundaries above — chunks moved by a few KB each from the added
`aria-*`/`role`/keyboard-handler code, nothing more:

| Chunk | Phase 2 (gzip) | Phase 3 (gzip) |
|---|---|---|
| `index-*.js` | 138.20 kB (38.41 kB) | 141.07 kB (39.26 kB) |
| `DecksView-*.js` | 40.24 kB (11.79 kB) | 41.39 kB (12.10 kB) |
| `GlossaryView-*.js` | 21.88 kB (7.90 kB) | 21.91 kB (7.92 kB) |
| `SetsView-*.js` | 20.03 kB (5.59 kB) | 21.05 kB (5.93 kB) |
| `LifeCounterView-*.js` | 11.49 kB (3.86 kB) | 12.50 kB (4.14 kB) |
| `Analytics-*.js` | 8.61 kB (2.97 kB) | 8.66 kB (3.01 kB) |
| `ImportModal-*.js` | 12.54 kB (4.79 kB) | 12.95 kB (4.96 kB) |
| `SettingsModal-*.js` | 12.87 kB (3.44 kB) | 13.51 kB (3.55 kB) |
| `papaparse-*.js` | 19.88 kB (7.43 kB) | 19.88 kB (7.43 kB) — untouched |
| `recharts-*.js` | 563.29 kB (157.97 kB) | 563.29 kB (157.97 kB) — untouched |

What has to load before the app is interactive is still ~139 kB gzipped — still an 84%
cut from the original 845.00 kB single-bundle baseline. All 32 `*-test.jsx` smoke tests
pass unchanged (5 of them were migrated off exact-inline-style-string locators onto a
`data-role="modal-backdrop"` attribute on `ModalShell`, added as part of this pass).

## Net effect

What has to load before the app is interactive dropped from 845.00 kB to 138.20 kB
gzipped (38.41 kB) — an 84% cut. A session that only ever opens the Collection tab, which
is most sessions, never fetches `recharts`, `papaparse`, or any of the other four views'
code at all.

Google Fonts also moved from three separate runtime `@import` fetches — injected by
`App()`, `AuthGate`, and `ProfileGate` respectively, each re-firing on every boot-state
transition — to a single `<link rel="stylesheet">` in `index.html`, loaded in parallel
with the JS from the very first request instead of after a component mounts.

## What this didn't change

Tab switching is still instant client-side navigation (no page reloads), and the app
still works fully offline against `localStorage` exactly as before — the split only
changes *when* each view's code is fetched, not how the app behaves once it's loaded.
All 32 `*-test.jsx` smoke tests (`npm test`) pass unchanged against the split codebase.
