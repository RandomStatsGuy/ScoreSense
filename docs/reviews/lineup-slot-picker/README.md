# Lineup position picker — approved option A

Manual position buttons open eligible replacements; no write occurs until Start is confirmed. Existing recommendation Tickets remain available. Linked Sleeper lineups open Sleeper for edits.

## Verification

Production components were tested with deterministic league responses, including isolated writes. No production league was changed. Screenshots cover the actual component at 1280 and 390, with synthetic players/projections. Full authenticated application chrome was not visually verified on this branch.

| State | 1280 | 390 |
| --- | --- | --- |
| Position picker with move preview | PASS | PASS |
| Saved lineup board | PASS | PASS |

All layout checks passed: bars, collisions, tables, grids, targets, primary actions, type, gutters, selects, overflow and menus. See `layout-report.json`.

Browser checks cover eligible positions, keyboard arrows, focus trap/return, confirm-only writes, swap payload/week, empty-slot fill, save errors retaining selection, player locks, locked starter, read-only lineup, Sleeper link, no eligible players, missing projections, loading and failed loads. No page errors occurred.

## Reproduce

From `frontend`, run `npx vite build --config vite.lineup-qa.config.js`. Serve `frontend/qa-dist` with the existing static preview server or a local static server. Set `LINEUP_PICKER_QA_URL` to the served `/test-fixtures/lineup-picker.html`, then run `node scripts/dev/lineup_picker_browser.mjs` from the repository root.

The fixture and QA bundle are excluded from the production app entry. Generated `qa-dist` is ignored.
