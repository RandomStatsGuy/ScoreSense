# DFS validation and Captain control review

Surface: `tools.dfs` (`frontend/src/LineupOptimizer.jsx`).

The existing DFS workspace fixture renders the real components with mocked API
responses. It verifies the Captain-only selection sends `max_overlap=6`, and
switching to Classic removes that option and sends `max_overlap=8`.
Backend tests separately exercise the real optimizer and validator.

| Width | Control checks | Layout audit |
| --- | --- | --- |
| 1280 | PASS | PASS (11 rules) |
| 390 | PASS | PASS (11 rules) |

Screenshots were visually inspected: [desktop](captain-1280.png),
[phone](captain-390.png). Raw measurements: [report.json](report.json).
Reproduce with Vite on port 5173 and `node scripts/dev/verify_dfs_captain.mjs`.

## Validation

- Focused backend: 117 passed.
- Focused frontend: 60 passed.
- Production frontend build: passed.
- Full frontend: 858 passed, 4 failed in unchanged Fantasy contract and accuracy
  copy tests (`draftRoomHelpers`, `rosterFormat`, `accuracyPresentation`).
- Broad backend checks encountered Windows shell limitations in
  `test_render_blueprint` (`/bin/sh` missing) and `test_resolve_python`
  (Windows path passed to bash). These do not exercise DFS.

## Unchecked surfaces and limits

The authenticated live `/tools/dfs` route, live slate feeds, site submission,
loading/error/readonly states, and other product destinations were not browser
verified. The screenshots show fixture data, not solver-generated portfolios.
This pass does not certify scoring rules, game lock state, exact game membership,
stack constraints, or contest entry acceptance. No production deployment was run.
