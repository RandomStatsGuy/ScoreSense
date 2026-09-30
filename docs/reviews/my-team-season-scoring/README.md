# My team season scoring A

Production components exercised in isolated fixtures with illustrative data. Live production leagues and deployment were not checked.

| Surface / state | 320 | 390 | 1280 |
|---|---|---|---|
| Standard and salary roster, player details | PASS | PASS | PASS |
| Empty, loading, long names, score error | PASS | PASS | PASS |
| Right locker position, close, Escape, focus return | PASS | PASS | PASS |
| Shared read-only room | — | PASS | PASS |

Backend: 119 scoring/room/product tests passed; another 36 season/Sleeper tests passed. Frontend presentation and audit unit tests: 27 passed. Build passed. Reproduce UI checks with `node scripts/dev/check_team_scoring.mjs`.

Scores use completed-week caches; linked Sleeper history is populated by league sync. Native historical cache recovery is bounded and asynchronous. Missing projections remain a dash. No paid checks, merge or deployment requested.