# Cap mobile B review

Approved compact Cap sheet, collapsed extension previews and Around the league.

## Verification

- Backend Cap/DB-only endpoint tests: 23 passed.
- Focused Cap/extension frontend tests: 21 passed.
- Product/design registry checks: 36 passed.
- Frontend production build: passed.
- Production-component fixture: 320, 390 and 1280 passed extension math, collapse/edit/revert, other-team access, no roster writes and horizontal overflow checks.
- Error, loading, empty, readonly, non-salary and missing-data states exercised.
- Layout audit: 390 and 1280 passed all checks.
- Real production league writes and My team/Rules were not exercised. The fixture records writes locally; league authorization is covered by backend tests.

The broader frontend unit run: 884 passed, 5 failed. Failures are unrelated copy assertions in contract labels, accuracy copy and the older My team banner rule; see PR notes. Draft only; no paid checks or deployment.

## Screenshots

| View | Phone | Desktop |
| --- | --- | --- |
| Cap / extension preview | [390](cap-390.png) | [1280](cap-1280.png) |
| Around the league | [390](league-390.png) | [1280](league-1280.png) |

Run the reproducible fixture through Vite at `/test-fixtures/cap-planner.html`, then `node scripts/dev/cap_planner_browser.mjs` with `CAP_PREVIEW_BASE` pointing to that URL. The default URL is the isolated compiled local preview. Screenshots use illustrative teams and canonical server-generated cap schedules.
