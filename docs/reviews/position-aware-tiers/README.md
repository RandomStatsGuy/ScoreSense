# Position-aware projection tiers — October 14, 2026

Follow-up to the merged B board (PR #739). [Benchmark sources and all cutoffs](../../PROJECTION_TIERS.md) are independently calibrated from published 2026 full-PPR FantasyPros and ESPN projections. They are fixed display benchmarks, not recalculated from the ScoreSense slate and not provider-published S/A/B labels.

Weekly S begins at QB 21 / RB 20 / WR 19 / TE 14; full-season S begins at QB 350 / RB 340 / WR 320 / TE 240. Full-season grouping reads the same season P50 total shown in the row. Live ROS remains based on the remaining forecast per known remaining game; recorded views use recorded PPG, not the current week. All filtered rows remain included; F has no lower bound or count limit (≤6 per-game; ≤100 full-season). Unknown points/identity remain visible as Untiered. WR/TE use each player's actual position, with both thresholds shown in mixed tier headings.

## Checks

| Surface | 1280 | 390 | 320 |
| --- | --- | --- | --- |
| Weekly | PASS | PASS | PASS |
| Full season | PASS | PASS | PASS |
| ROS / recorded / completed season | PASS | PASS | PASS |
| Player card / expanded details / bye card | PASS | PASS | PASS |

`audit.json` contains 102 unique passing measurements. The full production App and existing player inspector run against explicit isolated in-memory example API responses: ready, very large figures, missing, empty, loading, error, 810-player lists, outside-industry reference values, mixed WR/TE, completed seasons, a season-total-versus-weekly conflict scenario, explicit byes, and expanded player-card details. Desktop uses dark theme; phones use light theme. Selected screenshots were visually inspected. No runtime errors or API writes.

The season conflict fixture intentionally gives one player 30 weekly points with an 80-point season, and another 5 weekly points with a 360-point season. The former lands in seasonal F, the latter S at all three widths, proving the annual board reads season totals. Mixed WR/TE fixtures place equal 15.3 per-game players in WR A and TE S. External reference values qualify for S without promoting a low ScoreSense slate to fill the tier.

Explicit bye rows with high conditional projections remain in On bye without a rank, weekly forecast/range, leader signal, or compare addition. Clicking their names opens a Bye card with game history and rest-of-season data intact; CSV point fields say BYE. Missing schedule data does not imply a bye.

Expanded details retain typical positional miss, Recent usage, and Elevated uncertainty. Assumes-he-plays text, technical pipeline descriptions, duplicate headings, and empty narrative context are removed. Notes retain actual reporting; projection deltas and empty Older notes sections are omitted. The fixture deliberately includes obsolete boilerplate to verify it cannot leak into the card. Open cards are measured as well as boards, including explicit text/numeric game-log column alignment.

Browser checks also preserve comparison selection/clear, opening names while selecting, search/reset, within-tier sorting, centered desktop inspector, phone bottom inset, in-season card tabs, and game log. Every primary number fits its cell and viewport. The 810-player weekly sweep reaches every row at desktop/390; all three views reach the last zero-point player at all widths; desktop CSVs export all 810 rows.

- Frontend and layout unit tests: **1,308 passed**.
- Product/static, ROS/cache/roster identity pytest: **79 passed**.
- Player-card API, JSON safety, in-season projection pytest: **14 passed**.
- Python checks emit one existing dependency deprecation warning per run.
- Production build and diff checks: **passed**.

Verification uses fixture APIs, not live provider/authentication/scoring services. Fantasy/Tools, model accuracy, and real league data were not revalidated. Backend changes preserve position during ROS aggregation and apply the existing roster identity overlay to legacy cache reads. Unknown identities stay unknown. No numerical model forecasts, league scoring, or on-disk cache artifacts changed. Standard/PPR switching is explicitly deferred by the user; current forecasts remain PPR.

Run `node scripts/dev/projection_tiers_browser.mjs --view=weekly`; then `--view=preseason --append` and `--view=live --append` to check in separate browser runs. `--states=industry,mixed --append` replaces just those scenarios after fixture changes. Outputs stay under `outputs/projection-tiers-review`.

## Screenshots

| Scenario | Desktop | Phone |
| --- | --- | --- |
| Outside RB reference values | [1280](weekly-industry-1280.png) | [390](weekly-industry-390.png) |
| Actual WR / TE split | [1280](weekly-mixed-1280.png) | [320](weekly-mixed-320.png) |
| Annual total overrides weekly strength | [1280](preseason-seasonTotals-1280.png) | [390](preseason-seasonTotals-390.png) |
| Explicit bye rows | [1280](weekly-bye-1280.png) | [390](weekly-bye-390.png) |
| Concise projection details | [1280](weekly-details-1280.png) | [390](weekly-details-390.png) |

[Annual WR/TE at 320](preseason-mixed-320.png) · [Recorded season](live-recorded-390.png) · [Final F player at 320](weekly-tail-320.png)

[Bye player card at 390](weekly-bye-card-390.png) · [Bye board at 320](weekly-bye-320.png)
