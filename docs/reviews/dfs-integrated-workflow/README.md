# DFS integrated workflow review

October 11, 2026. This draft targets `develop` and explicitly depends on open draft [PR #706](https://github.com/RandomStatsGuy/ScoreSense/pull/706), without merging it. Base: `a69969ca065bf85941d397edf9f24d940467994a`. Production components use clearly synthetic local responses and intercepted fixture assets. No live account, paid source, submission or original incident is shown.

The scope integrates Generate → Review portfolio → Review entries → the exact entry-update download, independent capability states, retained/cancelled/failed/partial builds, accumulated pair/core hard bounds and soft misses, affected-lineup navigation, selected-lineup/whole-batch replacement from existing compatible candidates, apply/undo and frozen lineage, staged input versions/undo, and compact worker recovery.

| Check | Actual result |
|---|---|
| DFS frontend | 213 passed; 23.149 s |
| Broad frontend | 1,162 tests; 1,159 passed, 3 baseline failures; 25.353 s |
| Same failures on frozen base | 33 passed / 3 failed across draftRoomHelpers, accuracyPresentation and livingSurfaces; 0.163 s |
| Production build | PASS; 9.76 s; backup worker emitted (50.77 kB), existing >500 kB warning |
| Affected policy Python | 36 passed; 4.04 s |
| Integrated workflow/layout | Eight cases passed: 390/768/1280/1440, dark/light; real worker and no browser errors |
| Supplemental races/polling | Seven checks passed in the final default and separate corrected invocations |
| Direct normal 150 workflow | PASS at 390 dark and 1280 light; one auto-collected 150-lineup batch, 150 assignments, exact sealed CSV, unrelated reservation preserved, exact recovery without regeneration |
| Prior guardrail/foundation tasks | Eight cases each passed, including independent export/hash and authorization races |
| Prior portfolio and stress tasks | PASS at 390/1280; existing 150-entry restore/export and 140-lineup/700-player worker backup |

The final default workflow invocation exited 0, including all eight width/theme cases, seven supplements and both direct150 workflows. Separate supplemental-only and normal150-only invocations also exited 0. Earlier harness runs exposed stale selectors, an immediate assertion before async import committed, incomplete synthetic template headers and an overbroad hidden-table check; those were corrected before the clean final run. Browser review also found and fixed actual backup-focus timing and phone numeric/player-bound overflow. The three broad failures reproduce on this draft's own frozen base. The earlier phase's 2,880-pass full backend result is evidence for its earlier commit only; phase 3 changes no backend/API implementation.

Compact stress used seven saved batches, 140 lineups and 700 salary players. Identical expanded history occupied **12,389,150 bytes in version 1 → 1,085,295 bytes in version 2** (8.8%). Both supported versions restored exact original history. The actual production worker was observed and the main thread painted frames during its visible busy state: 1280: 64 frames / 1268 ms, 390: 52 frames / 1099 ms. These are synthetic browser/file download round trips, not isolated worker or production runtime benchmarks. Browser errors were zero and no lineups were regenerated.

Version 2 still limits input to 20 MiB, expanded data to 64 MiB and expanded values to 2,000,000 and depth to 24. Unusual collections with many full-pool replacement histories may exceed those limits. Writer/readback validation rejects an oversized backup before download and preserves the collection; compact encoding is not unlimited history storage.

The [compact verification record](verification.json) includes measured geometry, successful supplemental/150 records and backup stress counts only. It contains no account input, template, full backup or paid source data. Full local logs remain under `outputs/`.

Run sequentially from the repository root; these scripts share a temporary bundle:

```powershell
node scripts/dev/dfs_workflow_tasks.mjs
node scripts/dev/dfs_workflow_tasks.mjs --supplemental-only
node scripts/dev/dfs_workflow_tasks.mjs --normal-150-only
node scripts/dev/dfs_rebuild_browser.mjs --guardrails-only
node scripts/dev/dfs_rebuild_browser.mjs
node scripts/dev/dfs_portfolio_browser.mjs
```

The bundle includes a separate real worker entry. Browser interception prevents reaching another checkout's server or live API; no additional app server is started. The default workflow command includes the supplemental and direct-150 cases for subsequent regression runs.

Inspected synthetic screenshots retain the approved production design. The before/after pair shows the same scope before generation and after result retention. Numeric replacement values and visible roster tables are measured within their panels; keyboard apply/cancel and async backup return visible focus.

| View | Evidence |
|---|---|
| Phone before / after, dark | [Before](workflow-before-390-dark.png) · [After](workflow-after-390-dark.png) |
| Desktop before / after, light | [Before](workflow-before-1280-light.png) · [After](workflow-after-1280-light.png) |
| Player bounds and actual counts, phone dark | [Opened player cards](collection-player-bounds-390-dark.png) |
| Combined pair/core bound, phone light | [Collection audit](collection-audit-390-light.png) |
| Whole-batch numeric delta, phone dark | [Replacement preview](replacement-390-dark.png) |
| Original/candidate rosters, desktop dark | [Selected-lineup preview](selected-replacement-1280-dark.png) |
| Explicit incoming input version, desktop light | [Update preview](input-update-1280-light.png) |

Limits: no full WCAG certification; unrelated Fantasy/Projections contexts are not exercised. Collection sums may mix historical forecasts and are labeled original-input sums. Common decision-time reevaluation/shared-scenario concentration audit remains DATA-07/PORT-02 work. Replacements use already generated compatible candidates rather than targeted regeneration. Role/opportunity recommendations, statistical phases 4–7 and accepted-entry late swap remain gated. Original incident inputs are absent and platform acceptance is unconfirmed.
