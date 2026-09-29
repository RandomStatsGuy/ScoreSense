# DFS snapshot persistence review

Surface: tools.dfs. No layout or control changes; the existing Save build action
now retains the server build-input record and capture time.

| Fixture width | Save original snapshot, Captain rotation, Classic switch | Layout |
| --- | --- | --- |
| 1280 | PASS | PASS (11 rules) |
| 390 | PASS | PASS (11 rules) |

Visually inspected screenshots: [desktop](captain-1280.png), [phone](captain-390.png).
[Raw audit](report.json). Reproduce: `node scripts/dev/verify_dfs_captain.mjs` with
Vite on port 5173. The fixture renders real components but mocks API responses.
The save assertion checks both snapshot ID and original server capture time.

- Targeted backend: 144 passed, including exhaustive Captain comparisons, snapshot
  immutability, seed reproduction, API integration and account-scoped storage.
- Production frontend build: passed.
- Full frontend: 858 passed, 4 failed in unchanged draftRoomHelpers, rosterFormat,
  and accuracyPresentation tests, matching the preceding PR's baseline failures.
- No full backend rerun in this milestone. The preceding broad run had Windows
  shell blockers; this milestone uses the focused DFS regression suite.

The authenticated live route, real salary providers, submissions, and other product
surfaces were not checked. The Captain comparison is API-only, not shown in these
screenshots. No new comparison UI or production deployment is included.
