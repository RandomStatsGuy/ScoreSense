# This Week A — implementation review

Approved September 29, 2026. Matching surface: `hub.week`, `WeeklyExperience.jsx`.

## Implemented

- Compact forecast with Lineup first; one selected week owns lineup, matchup and league views.
- Single phone toolbar; desktop league switcher remains left aligned.
- Square position buttons on starters **and bench** open the existing move picker. Bench entry chooses an eligible starter slot; all writes require confirmation.
- Bench is a disclosure. `Manage in Sleeper` is below the player board; linked pickers also explain and link to Sleeper. No linked lineup writes are made locally.
- Rules recorded in PRODUCT and the living-surface registry.

## Focused verification

| Production components with isolated sample data | 320 | 390 | 1280 |
|---|---|---|---|
| Layout | PASS (long names) | PASS | PASS |
| Interaction/state checks | Not run | PASS | PASS |

`node scripts/dev/weekly_experience_check.mjs` exercises starter-to-bench and bench-to-starter moves, eligibility, empty-slot fills, confirmation/cancel, Escape focus restoration, rejected saves, kickoff/finalized locks, missing projections, loading/error/empty-roster states, Sleeper ownership, the Ticket entry point, week selection and all three views. Fixture writes stay in memory. The score-fetch error check also verifies the lineup can remain available without repeatedly changing the requested week.

Screenshots visually inspected: [390](calls-390.png), [1280](calls-1280.png), [bench picker](picker-390.png), [desktop bench](bench-1280.png), [Sleeper footer](sleeper-390.png). [Detailed state/layout report](browser-report.json).

Build passes. Focused frontend checks: 61/61. Product/static Python checks: 41/41. Full frontend suite: 827/832; five existing failures remain in contract labels/schedules, accuracy copy and DFS entry IDs. This change fixes the outdated Game center analytics expectation for the existing This Week alias.

## Shared-surface audit

All 34 registered routes were measured at both widths. This is not an all-green app audit: actual league pages still expose the untouched 29px chat dismiss control on phones, and desktop signed-out local chrome adds a second primary on several pages. Other pre-existing table and control-size findings remain. The newly added compact-header and square-lineup-control checks pass. Detailed reports: [390](routes-390.json), [1280](routes-1280.json).

| Route | 390 | 1280 | Remaining checks |
|---|---|---|---|
| `/hub/home` | PASS | FAIL | primaries |
| `/hub/strategy` | FAIL | FAIL | primaries, targets |
| `/hub/free-agents` | FAIL | FAIL | tables, targets |
| `/hub/draft` | FAIL | FAIL | bars, primaries, targets |
| `/hub/week` | FAIL | FAIL | primaries, targets |
| `/hub/vibes` | FAIL | PASS | targets |
| `/hub/game` | FAIL | FAIL | primaries, targets |
| `/hub/roster` | FAIL | PASS | targets |
| `/hub/rosters` | FAIL | PASS | targets |
| `/hub/cap` | FAIL | FAIL | primaries, targets |
| `/hub/trades` | FAIL | FAIL | primaries, targets |
| `/hub/rules` | FAIL | FAIL | primaries, targets |
| `/hub/roster-management/contracts` | FAIL | PASS | targets |
| `/hub/roster-management/rosters` | FAIL | PASS | targets |
| `/hub/roster-management/sheets` | FAIL | FAIL | primaries, targets |
| `/hub/roster-management/corrections` | FAIL | PASS | targets |
| `/hub/roster-management/members` | FAIL | FAIL | primaries, tables, targets |
| `/hub/roster-management/access` | FAIL | PASS | targets |
| `/hub/insights/overview` | FAIL | PASS | targets |
| `/hub/setup` | FAIL | FAIL | primaries, targets |
| `/tools/dfs` | PASS | PASS | — |
| `/tools/mock-draft` | PASS | FAIL | primaries |
| `/tools/best-ball` | FAIL | FAIL | tables, targets |
| `/projections/weekly` | PASS | FAIL | tables |
| `/projections/season` | FAIL | FAIL | tables, targets |
| `/model` | PASS | PASS | — |
| `/admin` | PASS | PASS | — |
| `/account` | PASS | PASS | — |
| `/report` | PASS | PASS | — |
| `/login` | PASS | PASS | — |
| `/register` | PASS | PASS | — |
| `/privacy` | PASS | PASS | — |
| `/terms` | PASS | PASS | — |
| `/sms-alerts` | PASS | PASS | — |

## Limits and release status

Not deployed. The branch starts from develop and includes the already-shipped weekly consolidation dependency before this mobile pass. Real local league Home, This Week/Game alias, Cap, My team and Rules were also opened and measured. No production lineup writes or external Sleeper session were exercised. Live draft timers, other pages' editing flows, and production authentication were not interaction-tested in this pass.
