# My team lineup flow — approved option A (October 17, 2026)

The Room is the fun landing editor: in native-scoring leagues a drop or tap on a lit locker saves the lineup at once, with Undo. Sleeper leagues keep previews and hand off to Sleeper. The Lineup tab stays the traditional list and gains Start best lineup.

## Verification

Production components ran against deterministic fixture responses with isolated writes; no production league changed. Screenshots show synthetic players and projections at 1280 and 390. Full authenticated application chrome was not visually verified on this branch.

| State | 1280 | 390 |
| --- | --- | --- |
| Room · bench jersey held (lit, dimmed and plated lockers) | PASS | PASS |
| Room · saved swap with Undo | PASS | PASS |
| Room · phone bench rack pick up / place / Put back | — | PASS |
| Room · Sleeper preview and hand-off | PASS | PASS |
| Lineup tab · Start best lineup board, review, saved, Undo | PASS | PASS |

Room checks: `node scripts/dev/team_room_preview_browser.mjs --workers 3` — 18/18 cases passed (native, Sleeper, pick light, live, read-only, missing forecast, locked, empty, error at both widths) with the shared layout audit. Native cases assert one swap request per drop, the saved status text and focus, Undo issuing the reverse swap, held-state counts and plates, the bench caption, the opponent projected line, and the phone rack flow.

Lineup checks: the Start best lineup block in `scripts/dev/lineup_picker_browser.mjs` (`state=best`) asserts one move per starter and bench player, the +4.1 review total, two sequential swap writes, the saved status, and a batch Undo that reverses them in order. `lineup-layout-report.json` holds the six passing audits. The script's older combined-state section predates the This Week overview change and was run separately from this block.

Units: `teamRoomPresentation.test.js`, `weekBoard.test.js`, `lineupPicker.test.js`, `lineupCommit.test.js`, `rosterPresentation.test.js`, `livingSurfaces.test.js` — 75 pass. `tests/test_team_room.py` and `tests/test_hub_scoring.py` — 80 pass. Production build passes with the existing chunk-size advisory.

## Reproduce

Serve `frontend/test-fixtures/team-room.html` and `lineup-picker.html` as esbuild bundles (the room script does this itself). For the Lineup block set `LINEUP_PICKER_QA_URL` to the served `lineup-picker.html` and run `node scripts/dev/lineup_picker_browser.mjs` from the repository root.
