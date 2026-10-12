# DFS rebuild foundation review

October 11, 2026. Screenshots show the actual production workspace components bundled from this branch, with explicitly synthetic players, lineups and local API responses. They do not show a live account, paid contest, original incident portfolio or an accepted DraftKings upload. Global selection in this browser fixture is labeled “fixture response”; solver correctness and runtime are tested separately.

| Check | 390 | 768 | 1280 | 1440 |
|---|---|---|---|---|
| Dark task + layout | PASS | PASS | PASS | PASS |
| Light task + layout | PASS | PASS | PASS | PASS |

The [compact results](responsive-results.json) retain outcomes without player/entry input files. Tasks cover separate minimum/target/maximum controls, declared percent/count conversion, a conflicting-bound request blocked before optimization, unchanged forecasts, actual/pair/FLEX display, reload recovery from IndexedDB without a downloaded backup, and format/slate/units keyboard focus. All controls fit the visible global panel; there is no page horizontal overflow. Shared layout checks cover tables, collisions, targets, typography, gutters and other measured rules.

The export regression passed at 390 and 1280: failed optional history synchronization retains an artifact, explicit recovery rechecks access, retry synchronizes without duplicate history rows, downloaded recovery and synchronized CSVs have identical bytes, and the downloaded CSV SHA-256 matches its audit manifest. Assignment selectors fit the visible list while preserving their full batch/lineup accessible names. A fresh 403 blocks recovery; changing accounts during a delayed first save blocks the second batch save, ledger import and CSV download. A 150-lineup three-batch export preserves an unrelated 151st entry. A 140-lineup / 700-player backup (588,251 JSON values) round-trips without changed batches or regeneration.

Screenshots were visually inspected after mobile grid clipping, assignment-selector clipping and table-width findings were fixed. Four scoped images total about 110 KB:

| State | Phone | Desktop |
|---|---|---|
| Global controls, generated audit | [390](global-controls-390.png) | [1280](global-controls-1280.png) |
| Optional history failure, explicit recovery | [390](export-recovery-390.png) | [1280](export-recovery-1280.png) |

Run from the repository root:

```powershell
node scripts/dev/dfs_rebuild_browser.mjs
node scripts/dev/dfs_portfolio_browser.mjs
```

The helper fulfills a bundled isolated fixture through browser request interception. It does not stop, replace or send API traffic to another checkout's existing port-5173 server. Run the scripts sequentially because they share the temporary bundle output.

Limits: this is scoped DFS task/geometry/visual evidence, not a full accessibility certification. Other Fantasy/Projections menu contexts were not exercised for the shared focus-only primitive change. Unknown platform locks still require explicit user attestation; known scheduled starts are checked separately, and platform acceptance remains unverified. Compact content-reference backups, exact pair/core editors, replacement previews and later model/data phases remain in [the full tracking matrix](../../DFS_REBUILD_IMPLEMENTATION.md).
