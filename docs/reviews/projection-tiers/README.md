# Tiered projections board review

Implements the approved B direction for Weekly, Preseason, and Live season. The improved player inspector is reused unchanged.

## Inclusion contract

S ≥24; A ≥18 and <24; B ≥12 and <18; C ≥9 and <12; D >6 and <9; F ≤6. No tier limits its player count. Zero and negative forecasts remain in F; unknown metrics remain visible as Untiered. Weekly unavailable and left-slate rows retain their own groups when included by the selected filter.

Weekly tiers use weekly projected PPR. Preseason uses projected PPR per game. Rest of season uses remaining points divided by known remaining games. Season so far uses recorded PPG, leads with cumulative points, and remains available for completed seasons. Sorting changes order within a tier; ranks use the full slate. CSV exports retain every filtered row.

## Verification

| Surface | 1280 | 390 | 320 |
| --- | --- | --- | --- |
| Weekly | PASS | PASS | PASS |
| Preseason | PASS | PASS | PASS |
| Live season / Season so far | PASS | PASS | PASS |

69 layout measurements in `audit.json`: ready, large numbers/long names, missing metrics, empty, loading, error, and 810-player lists for all three views; recorded and completed-season views at all three widths. All audit rules pass, with no browser runtime errors or API writes.

Browser interactions exercise search/reset, live-season sorting, comparison selection/clear, opening names during comparison, all in-season inspector tabs and the weekly game log. The desktop card remains centered within its overlay; the phone sheet remains anchored to its safe bottom inset. Every primary figure fits its cell and the viewport. Desktop and 390px scrolling reaches all 810 weekly rows; all three views reach the final zero-point player at every width, and each desktop CSV contains all 810 rows.

- Full frontend Node suite plus layout-audit unit tests: **1,299 passed**.
- Product/static pytest checks: **54 passed** (one existing dependency deprecation warning).
- Production frontend build: **passed**.
- `git diff --check`: **passed**.

Screenshots use the full production App and player card with explicit in-memory example API responses. Desktop uses dark theme; phones use light theme. Selected screenshots were visually inspected. No live provider refresh, authentication, real league data, backend forecasting, or Fantasy/Tools routes were validated in this UI-only change. The primary running checkout was left untouched.

Run `node scripts/dev/projection_tiers_browser.mjs` from the repository root. `--view=weekly|preseason|live` scopes a run; `--append` replaces that view's reports while retaining other views. Verification was completed in view-scoped runs after the Windows browser exhausted a network buffer during a combined run. `--export=<directory> --export-only` produces a local review preview with fixture data.

## Screenshots

| View | Desktop | Phone |
| --- | --- | --- |
| Weekly | [1280](weekly-ready-1280.png) | [390](weekly-ready-390.png) |
| Preseason | [1280](preseason-ready-1280.png) | [390](preseason-ready-390.png) |
| Live / recorded | [Remaining forecast](live-ready-1280.png) | [Recorded points](live-recorded-390.png) |
| Player inspector | [Centered](weekly-card-1280.png) | [Bottom sheet](weekly-card-390.png) |

[Large figures at 320](weekly-large-320.png) · [Final F-tier player at 320](weekly-tail-320.png)
