# Captain comparison interface review

Surface: tools.dfs. The new read-only panel uses the existing DFS panel, disclosure,
button and lineup-row styles. No CSS or export behavior changed.

| Browser fixture | State and preservation checks | Layout |
| --- | --- | --- |
| 1280 | PASS | PASS, 11 rules |
| 390 | PASS | PASS, 11 rules |

Visually inspected: [desktop panel](panel-1280.png), [phone panel](panel-390.png).
[Full-page measurements](report.json).

Reproduce with Vite on port 5173: `node scripts/dev/verify_dfs_comparison.mjs`.
The browser check exercises complete, partial, infeasible, error, sign-in required,
empty pool, loading, snapshot mismatch, late response after settings change, format
switching and preservation of the existing saved 20-lineup build.

Production frontend build passed. Full frontend suite: 860 passed and the same four
failures in unchanged draftRoomHelpers, rosterFormat and accuracyPresentation tests.
The two new unit tests cover request normalization/preservation and incomplete or
invalid comparison rendering. Backend code is unchanged; no backend suite rerun.

These are real product components with mocked API responses. The authenticated
live /tools/dfs route, provider data and contest submissions were not verified.
Other product surfaces were not browser checked. No production deployment was run.
