# Light theme review

Approved direction: B, soft canvas with additional blue current-context and teal healthy-state accents.

## Switching

- Desktop: sun/moon button next to the account controls.
- Phone: labeled switch at the top of More.
- Account: Color theme section; independent of Fantasy atmosphere.
- Dark is the first-visit default. The preference is browser-local, restored before app rendering, and synchronized between tabs. Blocked storage still permits an in-session switch.
- My team and Game center retain navy room artwork and their local readable palette.

## Validation

- Production Vite/PWA build passes; the startup theme script is precached.
- 47 targeted frontend/navigation/layout/theme tests pass.
- 34 product-constitution/living-surface Python tests pass.
- Full frontend suite: 804/810 pass. All six failures reproduce from an untouched `develop` archive with Windows line endings: draft availability source assertion, draft contract label, two roster-format assertions, accuracy copy, and DFS entry labels.
- Browser interaction checks pass: desktop switching, reload persistence, cross-tab updates, phone More switching, and light surfaces on phone navigation/filter bars.
- Layout audit measurements covered 34 registered routes at 1280 and 390. The light/dark comparison found no light-only findings. Existing table packing/alignment, target-height, and primary-count findings are retained in `layout-all-report.json`; some route snapshots show loading/empty or permission-limited states with the local API.
- Final representative-page checks and screenshots are in `layout-report.json` and the adjacent PNGs. These are product renders, not the static concept.

| Representative page | 1280 | 390 |
| --- | --- | --- |
| Weekly projections | FAIL: existing table checks | PASS |
| Fantasy Home | FAIL: existing primary count | PASS |
| My team | PASS | FAIL: existing 29px chat target |
| Game center | PASS | FAIL: existing 29px chat target |
| Tools DFS | PASS | PASS |

Visually reviewed Weekly, Home, the mobile More sheet, My team, and Game center. Live auction interaction, authenticated account changes, and staff-only workflows were not exercised. No production deployment or league mutations were performed.

Reproduce after building: `node scripts/dev/theme_browser.mjs --all`. The script serves the isolated production build through Playwright request interception and uses the existing API proxy at localhost:5173; it does not start another server.
