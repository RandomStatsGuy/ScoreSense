# Compact weekly board header

October 14, 2026. Follow-up to merged PR #745.

Weekly's title, week/PPR context, movement filters, Export CSV and Compare now share the existing header primitive. Removed the duplicate desktop player count and routine “What changed vs prior refresh” line. The All filter and phone count still report totals. Context timestamps, stale refresh controls, unavailable-movement explanations, tier basis, sorting, board signals and player cards remain available. Empty metadata no longer reserves a toolbar row. Phone no longer renders an empty desktop header.

The compact header and its conditional notices measure **60px normally / 87px when stale** in the 1280px and 1024px fixtures. A reusable layout audit checks a compact intro height budget (96px on wide desktop, 160px for wrapped laptop controls). This budget includes notices and is opt-in; other page layouts are unaffected.

| Surface | 1280 | 1024 | 390 | 320 |
| --- | --- | --- | --- | --- |
| Weekly | PASS | PASS | PASS | PASS |
| Shared header consumers: preseason / live season | PASS | — | PASS | PASS |

- **62** passing production-App browser/layout measurements using isolated in-memory fixture APIs. Weekly covers ready, large, missing, empty, loading, error, bye, stale and unavailable movement at four widths, including player details/bye cards. Shared seasonal header consumers cover ready/large data at 1280, 390 and 320, plus recorded and player-card views.
- Clicked the relocated Compare button, selected/cleared players, opened names, used within-tier sorting/search, and checked CSV export. Filtering to an empty Attention view disables export; All restores the rows. Stale and unavailable explanations remain visible without the routine movement boilerplate. Selected desktop/phone screenshots visually inspected.
- **1,316** frontend/layout unit tests passed. The stock npm test directory argument is incompatible with the local Node runtime; the same complete test-file set and layout suite ran explicitly, with zero skipped tests.
- **62** product/living-surface/frontend static pytest tests passed (one existing dependency deprecation warning).
- Production build and diff checks passed.

Fixture verification does not revalidate live providers, authentication, model accuracy, or real league data. Fantasy/Tools were not rechecked. No numerical forecasts, tiers, scoring, API contracts, provider calls, or league writes changed. No merge or deployment.

## Screenshots

[Desktop](weekly-viewport-1280.png) · [Laptop](weekly-viewport-1024.png) · [Phone](weekly-viewport-390.png) · [320px](weekly-viewport-320.png) · [Stale notice](weekly-stale-1280.png) · [Movement unavailable](weekly-noMovement-1280.png) · [Preseason consumer](preseason-viewport-1280.png) · [Live-season consumer](live-viewport-390.png)

Reproduce with `node scripts/dev/projection_tiers_browser.mjs --view=weekly --states=ready,large,missing,empty,loading,error,bye,stale,noMovement --widths=1280,1024,390,320 --out=outputs/compact-weekly-review`. Use `--view=preseason` and `--view=live` with `--states=ready,large` for shared header consumers.
