# Retained salary-catalog verification

No visual controls or CSS changed. The existing DFS hook carries the salary snapshot
from load/import into ordinary builds and Captain comparisons, clears it on context
changes, and retains the snapshot request in saved-build settings.

| Browser fixture | Build/format switching | Captain comparison | Layout |
| --- | --- | --- | --- |
| 1280 | PASS | PASS | PASS, 11 rules |
| 390 | PASS | PASS | PASS, 11 rules |

Scripts: `node scripts/dev/verify_dfs_captain.mjs` and
`node scripts/dev/verify_dfs_comparison.mjs`, with Vite on port 5173.
The scripts now assert salary snapshot IDs, including a different ID after format
switching. [Build report](build-report.json), [comparison report](comparison-report.json).
Existing comparison screenshots are in [the prior interface review](../dfs-captain-review/README.md).

- Focused backend: 168 passed, including 24 new catalog/account/rule/integration tests.
- Production frontend build: passed.
- Frontend: 860 passed, four unchanged failures in draftRoomHelpers, rosterFormat,
  and accuracyPresentation, matching the preceding milestone.
- No full backend suite rerun.

Browser fixtures mock API responses. Real API integration is covered separately by
backend tests using temporary account-scoped storage. The authenticated live route,
provider feeds and contest submissions were not visually verified. No production
deployment was run. Scoring and live-lock certification remain false.
