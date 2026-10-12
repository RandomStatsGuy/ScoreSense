# Offline late-swap planning package

`dfs_late_swap_package_v1` is a bounded, user-supplied snapshot for read-only
DraftKings NFL Classic planning. It does not authenticate accepted entries,
current locks, rules or forecasts. No platform-ready late-swap file is offered.

The package has exactly these top-level fields:

```json
{
  "schema_version": "dfs_late_swap_package_v1",
  "context": {"site": "draftkings", "sport": "NFL", "format": "classic", "slate_id": "example", "season": 2026, "week": 6},
  "decision_at": "2026-10-11T20:00:00Z",
  "objective": "projection_guided_snapshot",
  "contest": {"contest_id": "001", "name": "Example contest", "late_swap_enabled": true, "lock_policy": "individual_game", "as_of": "2026-10-11T19:59:00Z"},
  "sources": [],
  "accepted_state": {"source_id": "readback", "readback_sha256": "REPLACE_WITH_64_HEX_CHARACTERS", "portfolio_version": "portfolio-v1", "export_version": "export-v1", "as_of": "2026-10-11T19:59:00Z", "entries": []},
  "catalog": [],
  "candidates": [],
  "controls": {}
}
```

This skeleton is deliberately incomplete. Each required list below needs actual
declared inputs. Do not turn placeholders into asserted platform evidence.
Identities support at most 100 characters without padding or control characters.
Times use `YYYY-MM-DDTHH:mm:ss[.ffffff]Z` or an explicit `±HH:mm` offset.

- `sources`: exactly one receipt for each `kind`: `user_platform_readback`,
  `rules`, `salary_catalog`, `lock_snapshot`, `projection_inputs`. Every receipt
  has `source_id`, `kind`, offset-aware `as_of` and 64-character hexadecimal
  `content_sha256`, and `rights` containing exactly `personal_analysis`,
  `hosted_ingestion`, `display`, each explicitly `true`. Missing or denied
  permission blocks ingestion; these declarations do not authenticate a
  license. IDs are distinct. Every timestamp is at or before
  `decision_at`; the lock snapshot time equals the decision time. Readback ID,
  timestamp and hash must agree with `accepted_state`.
- `catalog`: 1–750 rows with `player_id`, numeric-string `dfs_id`, `name`,
  `position` (`QB`, `RB`, `WR`, `TE`, `DST`), `team`, `opponent`, `game_id`,
  positive whole `salary` at most 50,000, offset-aware `kickoff_at`, `lock_state`
  (`locked` or `unlocked`), `status` (`eligible`, `out`, `inactive`, `unknown`),
  and `projection`. Canonical IDs and DFS IDs are unique. Players in one game
  share kickoff/lock state. Locked kickoff is at or before decision time;
  unlocked kickoff is later. Unknown timing or lock state rejects the package.
  An unlocked player's projection is a finite supplied input, bounded to
  ±1,000,000 with at most 12 decimal places. Locked projection can be null and
  does not contribute to the planning objective.
- `accepted_state.entries`: 1–150 distinct numeric-string `entry_id` values,
  exact `contest_id`, and `slots`. Each slot mapping contains exactly `QB`,
  `RB1`, `RB2`, `WR1`, `WR2`, `WR3`, `TE`, `FLEX`, `DST`, mapping to canonical
  player IDs. Baselines must be complete, position-compatible, unique within
  an entry, within the salary cap and include at least two declared games. Teams
  use recognized NFL identities with existing alias normalization. Distinct accepted entries may have the
  same scoring roster; they are never deduplicated or reassigned.
- `candidates`: 0–600 supplied alternatives with globally distinct
  `candidate_id`, existing `entry_id` and complete `slots`. Each locked
  baseline ID must remain in its exact slot. No other locked player can be
  added. The baseline is automatically retained as a separate option.
- `controls`: optional `player_exposure_limits`, `group_exposure_limits`,
  `locked_player_ids`, `excluded_player_ids`, `max_exposure`, `max_overlap`,
  `classic_stack_rules`, `block_qb_opposing_dst`, `max_per_team`, `min_salary`,
  `max_salary`. These follow existing native Classic semantics: hard fractions
  round minimum up and maximum down against the whole entry count; exact
  counts use `{"count": 10}`. Targets are soft. All locked appearances count.
  Default QB/opposing-DST prevention is enabled. A disabled safeguard is
  explicit in the frozen controls. Unsupported fields reject atomically.

All supplied slot/identity/lock/structural errors reject the complete import.
Structurally valid options failing chosen strategy rules remain visible as
rejection receipts and cannot be chosen. A feasible proposal chooses exactly
one option for every entry; it never silently drops an entry or relaxes a rule.

The objective first minimizes total absolute soft-target appearance misses,
then maximizes the sum of supplied inputs in unlocked slots. This is neither a
remaining-points forecast nor conditional contest return. Locked salary still
consumes budget, while locked points contribute zero to this objective.

`prepare_late_swap_package(payload, context=None)` normalizes and content-addresses
the snapshot. `late_swap_summary(prepared)` provides preview counts, locked-slot
counts, rejected options, source declarations and capability gates.
`plan_late_swap(prepared, time_limit=8)` returns `dfs_late_swap_plan_v1` with
`package_id`, `plan_id`, frozen `input_manifest`, `entries`, `changes`,
`constraints`, `targets`, `rejected_options`, independent `audit`, `solver`,
`baseline`, `proposed`, `capabilities` and `warnings`. Each entry contains
`entry_id`, `contest_id`, `candidate_id`, `before_slots`, `after_slots`,
`locked_slots`, `changes`, `projection_before`, `projection_after`,
`salary_before`, `salary_after`, plus complete `lineup` rows.
The manifest pins `offline_exact_slot_assignment_v1`, the actual NumPy/SciPy
versions and hashes of catalog, accepted state, controls and supplied options.

Small candidate products are enumerated exactly. Larger sets use the existing
SciPy MILP runtime with per-entry assignment constraints. Numeric certificates
are disclosed separately from exact proof; any returned incumbent is audited
again against complete frozen identities, slots, salaries and hard bounds.
Timeout, infeasible candidate pool, unresolved solver and complete feasible
proposal remain distinct. Candidate-pool proof is never full-universe proof.

`build_late_swap_csv_preview(template_text, prepared, report)` is an internal,
pure engineering dry run. It requires the exact original ordered DraftKings
columns and selected baseline DFS IDs, preserves metadata/unselected rows, and
reaudits the proposal. Its CSV bytes are not exposed by the API or product UI.
Authenticated acceptance, verified current locks, conditional remaining-slate
evaluation and platform-ready late-swap export remain unavailable.
