# DraftKings Classic shared-event scoring contract

Phase 5 implements `SIM-03` and the normalized-event portions of T02/T18. It does not certify a fitted joint model under T19. The pure adapter is `src/products/dfs_event_scoring.py::score_game_events(game, players, events, site="draftkings")`. Other sites and Captain formats reject instead of borrowing these rules. Existing projection heads and league scoring remain unchanged.

## Scoring receipt

Version: `draftkings_nfl_classic_2026-10-12_v1`. The [official DraftKings rules JSON](https://api.draftkings.com/rules-and-scoring/RulesAndScoring.json), sport `1`, rule `NFL Classic`, game types `1,158`, was read at `2026-10-12T17:32:04.522766Z`. It supplies offense coefficients, yardage bonuses, turnover deductions, DST categories and points-allowed bands. Defensive turnover touchdowns and ordinary safeties do not increase the surrendering team's DST points allowed; subsequent extra points do. Special-teams scores and conversion returns count toward points allowed. These category rules are versioned independently from any distribution model.

The whole response SHA-256 is `4ae6599b4159852e5106f451d87f3632c2cecccb7b8502bc4968a15319ce6f18`. The selected rule's sorted, compact JSON SHA-256 is `9c37b2570fc8282011a5af64e3549701b0c537242ee75712e79300fa5ee60c67`. DraftKings did not expose a publication timestamp in that section. Public rules were consulted to implement scoring; this is not a license for provider observations, training or raw-content redistribution. No provider rule-page copy is bundled.

## Normalized input

`game` has exactly `game_id`, `home_team`, `away_team` and `ledger_complete: true`. Completeness is the caller's explicit declaration, not an independently checked feed or game status.

`players` is a bounded list of 2–160 participants, each with exact `player_id`, NFL `team` and `opponent`, `position` (`QB`, `RB`, `WR`, `TE`, `DST`, `RESIDUAL`) and `status` (`active`, `inactive`). Exactly one active DST is required per team. An unselected or aggregated actor has a unique ID, `position: "RESIDUAL"` and `residual: true`. Residual actors remain part of target, completion, yardage and touchdown identities. Team aliases use the existing team helper; player IDs are never trimmed or guessed. Known inactive participants and explicitly declared zero-touch participants receive zero. Missing participants reject when referenced.

`events` contains at most 1,000 chronological events. Every event has exact `event_id`, `kind`, `team`, and `period` (1–10, with overtime included). IDs cannot repeat. Fields outside the kind's schema reject the complete request; numeric strings, booleans as counts, and unknown identities are rejected. A successful run never mutates caller objects or writes files.

| Kind | Required and optional payload |
| --- | --- |
| `pass` | `passer_id`, `receiver_id` (null for untargeted), `complete`, `intercepted`, integer `yards`, `td`; optional interception `return_td` |
| `rush` | `rusher_id`, `rush_type` (`designed`, `scramble`, `kneel`), integer `yards`, `td`; optional `safety` |
| `sack` | `passer_id`, nonpositive integer `yards`; optional `safety` |
| `spike` | `passer_id` |
| `no_play` | No additional fields; represents fully negated plays only |
| `field_goal` | `made`; kicker fantasy points are outside Classic |
| `extra_point` | `made`, `after_event_id` |
| `two_point` | `mode` (`pass`/`run`), `success`, applicable actor IDs, `after_event_id`; optional `returned` |
| `return_td` | `returner_id`, `return_type` (`punt`, `kickoff`, `field_goal`); `team` is returning team |
| `blocked_kick` | `kick_type` (`punt`, `field_goal`, `extra_point`), `return_td`; XP also requires `after_event_id`; `team` is kicking team |
| `safety` | `reason: "penalty"`; rush/sack safeties stay on their original event |

Pass/rush/sack events can add `fumbler_id`, `fumble_lost`, `fumble_return_td`; an ordinary pass/rush with a retained fumble can specify `recovery_td_id` for an offensive recovery touchdown. Actor and outcome combinations are checked. Every try must immediately reference one same-team touchdown exactly once. Try production does not become ordinary passing/rushing/receiving statistics. A touchdown does not silently manufacture an extra point.

The ledger contains already attributed official player yards. It is not a raw play-by-play adjudicator, field-position model or possession validator. Accepted penalties must already be reflected in these normalized yards. Laterals, self-completions, multiple possession changes, one-point conversion safeties, special-teams fumble chains, and undeclared play types are unsupported and must reject; do not drop those plays to claim a complete historical game. A source with such a play needs a future tested adapter revision before whole-game reuse.

## Output and checks

The output includes exact-ID `player_scores`, `player_stats`, `team_stats`, `game_score`, the scoring receipt/version, and a content hash over normalized game/roster/events/version. All offense and opposing DST events come from the same ledger. Bonuses apply once to final game totals; negative scores remain negative.

Independent team audits check:

- `plays = designed_runs + dropbacks`;
- `dropbacks = sacks + scrambles + throws` and `throws = targeted + untargeted`;
- official pass attempts include spikes; official rush attempts include kneels;
- targets/completions/receptions, passing/receiving yards and passing/receiving touchdowns reconcile across all participants;
- opposing defensive sacks, interceptions and fumble recoveries match offensive events.

Modeled plays exclude kneels, spikes, tries and no-plays. Official-stat counters retain the explicitly named exceptions. `audit.source_completeness_verified` is always false. Site scoring support does not imply calibrated specialist distributions, live source authenticity, field/payout support or contest EV. Those capabilities remain false.

Verification: 78 isolated synthetic scoring tests passed in 3.38 seconds. Reproduce from the repository root with `PYTHONPATH=.` and the project Python environment: `python -m pytest tests/test_dfs_event_scoring.py -q`. Tests cover threshold bonuses, every PA boundary, negative scoring, residual actors, shared sacks/turnovers, recovery/return/try treatment, overtime, aliases, atomic rejection and input bounds. Fixture correctness is not evidence of accepted contest settlement or forecasting accuracy.

A local synthetic bound check used 160 participants and 1,000 completed-pass events for 20 runs: median 14.116 ms, maximum 15.497 ms, returned JSON 76,471 bytes. It measures this adapter's bounded normalization/scoring cost only; it is not a plausible NFL game, an end-to-end simulator benchmark or a production latency claim.
