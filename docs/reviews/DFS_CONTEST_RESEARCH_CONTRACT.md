# Supplied contest research contract

Phase 6 adds conditional research for DraftKings NFL Classic. It does not fit an opponent model, certify ownership, authenticate a payout schedule, select a portfolio or modify entries. Missing statistical evidence keeps forecast expected payout unavailable.

## User flow and request limits

Inside **Compare & research → Shared-game scenarios**, select a current game bank and complete lineups. Open **Contest scenarios**, import the contest file, preview it, choose **Use these assumptions**, then compare. The file contains exactly `contest_field` and `payout_contract`. Research remains separate from normal projection builds and CSV downloads.

Patron-only `POST /api/lineup/contest-research/preview` accepts the frozen `context`, `pool`, raw `bank`, `contest_field` and `payout_contract`. Evaluation additionally requires `lineups`, `input_snapshot_id`, the previewed `bank_id` and `contest_research_id`, `seed`, `draw_count` and `top_k`. Exact source payloads are revalidated before every run; the server returns the supplied snapshot ID for the browser's stale-response checks.

Authentication precedes streamed body reads. Actual body bytes, independent of Content-Length, are limited to 8 MiB; duplicate JSON keys, nonfinite values, nesting above 24 and more than 250,000 values are rejected. The existing global CPU workers run validation and replay. Evaluation accepts 1–150 distinct scoring rosters, 32–256 draws, seed 0–2^31−1, at least one opponent and a top-finish cutoff within the contest size. Existing game-bank limits remain in force. There are no account/history/entry writes or external fetches.

## Opponent field

`contest_field.schema_version` is `dfs_contest_field_v1`; `mode` must be `declared_legal_lineup_templates`.

| Field | Required meaning |
|---|---|
| `context` | Exact site, NFL, Classic, season, week and slate ID matching the game bank/pool |
| `contest` | Exact `contest_id`, `contest_type` and `entrant_count`, including all reviewed own entries |
| `contest_type` | `mini_max`, `milly`, `single_entry`, `three_max` or `other_gpp` |
| `decision_at` | Declared zoned decision timestamp matching the game bank |
| `evidence_scope` | Explicit `synthetic`, `retrospective` or `live`; this declaration is not authentication |
| `sources` | 1–64 source receipts, with URI, content SHA-256, period, definition, publication/known/retrieval times and separate rights |
| `scenarios` | 1–4 distinct provider/news assumptions, each containing complete weighted legal rosters |

Each scenario requires `scenario_id`, `provider`, `injury_assumption`, `known_at`, `source_ids`, `split_id`, `ownership_units: "fraction"`, `ownership_contest_type`, `ownership` and `templates`. Ownership rows contain exact `player_id` and `projected_fraction` in 0–1 or null. Missing players remain unknown. The audience must match the declared contest type or explicitly be `broad_public`. Audience labels never certify contest-specific accuracy.

Each of up to 500 templates has a distinct `template_id`, nine `player_ids` and a positive finite `weight` no greater than 1,000,000. Rosters use exact pool identities, supported Classic composition/FLEX, at most $50,000 and at least two games. Equivalent rosters coalesce their weights; duplicates remain part of the opponent distribution. Conditional stacks, bring-backs and salary use therefore travel together. Player ownership is separate metadata: changing a percentage does not alter football scores or infer a stack probability. Whole-template weights define the sampled distribution, and supplied-vs-implied ownership gaps are reported as a consistency diagnostic.

Every source requires explicit personal-analysis, hosted-ingestion and display permission before upload. Publication/known times cannot follow the decision cutoff; retrieval cannot be in the future. Source references and assumption known-at must agree. These checks inspect declarations and do not prove provenance or past availability.

The actual contest is bounded to 100,000 entries. Every draw samples exactly `entrant_count − own_entry_count` opponents using compressed multinomial multiplicities; no small-field rank extrapolation occurs. Independent PCG64 streams record the NumPy version and field/assumption/purpose/seed/draw identities. Lazy iteration retains one field draw per assumption. Finite template support and independently sampled opponents can omit real manager-level behavior; there is no fitted or calibrated generator claim. Automatic entrant-count uncertainty analysis is not implemented; separately frozen exact-count packages can be compared manually.

## Cash schedule and ties

`payout_contract.schema_version` is `dfs_cash_payout_contract_v1`. Required fields are `contest_id`, `entrant_count`, `currency: "USD"`, `entry_fee_cents`, `paid_places`, `payout_tiers`, `unpaid_ranks: "zero"`, `tie_policy` and `noncash_prizes: []`. IDs/counts must match the field exactly. Each tier has `start_rank`, `end_rank` and `prize_cents`, with explicit consecutive coverage from rank 1 through `paid_places`; gaps and overlaps reject. A known zero-prize contest uses `paid_places: 0` and an empty schedule. Missing schedule/fee is not zero.

`tie_policy` requires `cash_split: "occupied_rank_mean"`, a declared `rounding` of `exact_fraction`, `floor_cent` or `half_up_cent`, and `source: {source_uri, content_sha256, as_of}`. The URI/hash must match an admitted field receipt and as-of cannot follow the decision time. This source is the caller's supplied schedule/policy reference; it is not a built-in platform receipt. `exact_fraction` represents research before settlement. Unsupported noncash prizes reject rather than silently becoming cash.

Exact decimal actor totals determine score equality; no tolerance manufactures ties. If `b` entries score higher and `m` entries tie, the unrounded share is the sum of prizes for ranks `b+1` through `b+m`, divided by `m`. Own entries contribute to both counts. Each own entry receives its declared per-entry share; fees are deducted once. A $100/$50/$20 three-entry tie pays $170/3 per entry before declared rounding. Two own entries receive two shares. Unpaid ranks contribute zero; rounding remainder is explicit in the pure adapter.

Money uses `{unit: "USD_cents", numerator: "…", denominator: "…"}` with integer strings. Long exact draw-average fractions are preserved in saved reviews. Browser displays are rounded approximations, never settled account revenue.

## Results, diagnostics and remaining gates

All own and opponent rosters use each common whole-game draw. Provider assumptions change fields, not game scores. Reports separate scenario net/payout distributions from sampled at-least-one top-finish fractions. Top-k includes a tie whose first occupied rank reaches the cutoff; tied-first and sole-first remain separate. Replay standard error measures finite sampling noise only, not confidence in future returns. Selected hashes, policy, source receipts and streams support reproducibility without proving an untouched evaluation.

The optional offline command `python -m src.analytics.dfs_contest_field_eval --input <package.json> --output <report.json>` compares bounded counted legal generated and observed rosters. Its versioned manifest records disjoint training/tuning/evaluation blocks, a freeze before evaluation, separate forecast/observation receipts and actual contest/sample coverage. It reports player and pair frequency errors, QB attachments, opposing offensive bring-backs, salary distributions and repeated construction rates. A declared holdout is not independent certification, and no real archived-field result is shipped in this PR.

Personal browser reports retain computed results, own frozen inputs and source-right declarations, but omit raw opponent templates, player ownership observations and game ledgers. No training/public redistribution permission is inferred. Failures retain earlier reviews; changed settings/inputs mark them stale; account changes discard research state.

Engineering fixtures in `frontend/test-fixtures/dfs-contest-data.json` and the tests are explicitly synthetic. Reproduce the browser file with `scripts/dev/build_dfs_contest_browser_fixture.py`. They test plumbing and exact math, not real contest acceptance, ownership calibration, joint tails or a tournament advantage. Those evidence gates, authenticated real contest contracts, noncash settlement, automatic field-size sensitivity and multi-slate untouched forward evaluation remain open.
