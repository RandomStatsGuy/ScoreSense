# DFS player estimates

The DFS pool is materialized separately from the starter-oriented weekly and Fantasy pools. It includes current eligible roster depth and profiles for players without individual history. Salary rows match one-to-one by normalized name, team, and position; blank provider export IDs no longer prevent suffix/nickname recovery. Export IDs are never fabricated.

## Sources and eligibility

- **ScoreSense:** ordinary skill-position projections and the separate DraftKings defense head.
- **Roster estimate:** existing position-model inference over a low-usage profile when individual history is absent. This is approximate; the coverage API does not count it as an individually modeled player.
- **Historical estimate:** prior-three-season team kicking P10/P50/P90, assigned only to a uniquely identified available starting kicker. These shared ranges do not rank kickers by matchup. Full-game DK and FD kicking rules match. Both single-game formats include K; Classic does not.
- Confirmed unavailable skill players can remain as metadata-only rows. Missing inputs never become zero-valued eligible players. Ambiguous starting kickers, team disagreements, position disagreements, and unsupported real-world roles require resolved source data or complete imported estimates.
- DraftKings DST uses team forecasts instead of fixed 7/4/11 values. FanDuel retains its explicitly labeled fixed defense estimate; its different defense scoring has not been modeled here. Do not treat it as calibrated or apply the DK head there.

The scoring implementation follows the [DraftKings full-game Showdown rules](https://www.draftkings.com/help/rules/1/96); kicking bands also match [FanDuel NFL rules](https://www.fanduel.com/rules). The model does not support half/quarter contests. Existing skill projections remain the product's current PPR models, not newly validated site-specific scoring heads.

## Training and evidence

`PYTHONPATH=. python -m src.jobs.train_dfs_special_teams --through-season 2025`

This offline command fetches public nflverse team game outcomes and schedule scores, records source hashes, reconstructs DK scoring, evaluates expanding-season 2023/2024 folds, and fits the defense bundle only after the gate passes. Runtime inference never trains. Historical contexts at or before the bundle's training season cannot use the fitted head.

The declared initial defense gate requires both folds to beat the unconditional median MAE and mean three-quantile pinball loss, with interval coverage between 70% and 90%. Defense passed; the kicker candidate failed. See `artifacts/models/v2/dfs_special_teams.evaluation.json` for all metrics, including the empirical kicking baseline. This modest baseline comparison is not validation of lineup win probability, correlated outcomes, ownership, or contest returns.

## Freshness and deployment

The existing five-minute background refresh forces the roster/injury feed, refreshes weekly artifacts, and now builds injury-adjusted and raw deep DFS artifacts. It also polls current-season observed team results. Provider publishing cadence is outside our control: five-minute polling does not create data the provider has not published. A missing current-season history feed after week one cannot advance the refresh success timestamp. Status records the source history's latest season/week and whether only historical inputs were available.

Both variants are computed before either is published. Each file is atomically replaced; an inference failure preserves prior artifacts. The two replacements are not a cross-file transaction. Request paths read the materialized deep pool; when absent they retain the existing weekly fallback and explicit incomplete-coverage report. Refresh runs share the existing process lock and throttle.

The model bundle ships with the code. Generated `artifacts/dfs_predictions/` files are ignored and excluded from deployment archives so a developer's local pool cannot overwrite production. Merge/deploy must occur before the API's background ticker runs this code. This PR does not deploy or create a separate scheduled task.

## Public-catalog audit

Local run on September 28, 2026, using explicitly selected season 2026/week 4 and a freshly polled roster: 884 materialized rows, including 32 starting kickers and 32 defenses. This tests coverage against catalog rows; it does not certify that every catalog date matches the selected projection week or prove production is running the change.

| Catalog | Complete | Missing with unavailable status | Other missing |
| --- | ---: | ---: | ---: |
| DK 153790, PHI/CHI Showdown | 47 / 56 | 6 | 3 |
| DK 154078, Classic | 544 / 619 | 62 | 13 |

The Showdown exceptions are Scotty Miller (team not resolved in the roster feed), Qadir Ismail (WR/TE disagreement), and Rocco Underwood (long snapper listed as TE). Classic exceptions additionally include special-team/defensive players listed as offensive positions and current team/position disagreements. `docs/reviews/dfs-player-estimates/live-coverage.json` preserves names and reasons. These are unresolved gaps, not covered players. Imported complete estimates remain available; copying cross-team or cross-position projections automatically is intentionally disallowed.

Both starting kickers from the public Showdown catalog successfully built as locked Captain, at $49,600 and $49,500 total salary. Public fallback IDs were blank, so this is a solver check, not an upload/entry-acceptance claim.

## Review checks

- Backend: 301 DFS, API, lineup, roster, depth, projection, and product tests passed, plus the subsequently added missing-veteran test (35 current estimate-module tests passed).
- Frontend: build passed; 860/864 unit tests passed. The four unchanged baseline failures cover two contract labels, a flat salary schedule, and accuracy copy.
- Real DFS components with mocked API responses: 1280 and 390 layout/interaction checks passed, including timed refresh, failure/recovery, and preservation of saved build inputs. Screenshots are in `docs/reviews/dfs-player-estimates/`; the fixtures are not production or live-account verification.
- Full repository suite and live production UI were not checked. No deployment, contest entry, or merge was performed.
