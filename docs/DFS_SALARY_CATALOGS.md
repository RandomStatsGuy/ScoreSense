# Retained DFS salary catalogs

Authenticated salary loads and CSV imports now retain a content-addressed catalog
in the existing DFS results database. The `salary_snapshots` table is created
idempotently alongside existing account-scoped tables; no separate database or
manual migration is required. Writes are insert-only. Identical content for the
same account reuses its ID and first capture time; changed content gets a new ID.
No cleanup deletes catalogs referenced by old builds.

## Request boundary

Salary responses include `salary_snapshot`. The browser sends its ID on ordinary
builds and Captain comparisons, replacing it on a new pool and clearing it when
context changes. The optimizer resolves the ID under the authenticated account,
checks its content hash, selected format/slate and retained roster configuration,
then uses the stored rows for the salary join. When browser salary rows are also
supplied, their normalized identities, IDs, roles, teams, positions, salaries and
game labels must match exactly; adding, removing or duplicating rows fails.

The build-input record includes this snapshot summary. `slate_validation.scope`
is `retained_salary_catalog` on bound requests. The source distinguishes
`provider_catalog` from `uploaded_csv`. Uploaded files do not become trusted
provider observations merely because they have been retained.

Older API clients and anonymous local previews can still build without a snapshot;
they return `unbound_client_inputs`. They cannot claim retained-catalog validation.
A supplied snapshot ID requires authentication and never falls back to inline rows
when missing, stale against rules, altered or owned by another account.

## Checks and boundaries

- Known lobby category must agree with Classic versus single-game format.
- Explicit Captain rows cannot masquerade as a Classic catalog.
- Catalog identities must be unambiguous; a salary ID cannot identify two players.
- DraftKings Captain and FLEX IDs must differ when both are available.
- Single-game catalogs need exactly two teams; contradictory Game Info labels
  are rejected before role rows collapse.
- CSV Game Info is retained. When present, a row's team must belong to its listed
  matchup. Missing game metadata remains explicitly incomplete.
- Bound requests cannot exceed the retained salary cap or default team maximum;
  tighter user constraints remain supported.
- Previously merged independent lineup validation still checks generated rows
  against the eligible pool built from this catalog.

This is **salary-catalog membership and supplied-game consistency**, not a complete
exact-game/provider identity registry. Existing guarded name/team/position matching
and role inference remain. Missing export IDs still permit previews and still block
site uploads. Provider fallback catalogs may lack IDs and game metadata.

`scoring_verified` and `lock_state_verified` stay false. Capture time is not source
publication time, and retaining a cached provider catalog does not make it fresh.
No live kickoff/inactive checks, accepted-entry validation, verified site scorer,
model recalibration or automatic contest submission is added. Forecasts remain
legacy projection inputs. Saved-build export behavior is unchanged.

## Rule-source investigation

Checked September 28, 2026: the official [DraftKings rules entry point](https://www.draftkings.com/help/rules/nfl)
and [Showdown overview](https://support.draftkings.com/dk/en-us/game-style-showdowns-overview?id=kb_article_view&sysparm_article=KB0010694).
The rules reader returned page chrome rather than the complete scoring tables.
This milestone does not substitute remembered scoring values or certify a scorer
from general game-style documentation. Full site-scoring verification remains work.

## Verification

Tests cover immutable reuse/version changes, account isolation, content tampering,
format/slate mismatches, supplied-row edits/additions/removals, contradictory games,
missing metadata, duplicate role IDs, rule drift, format limits, authenticated load
and import, real optimizer/Captain integration, and explicit legacy behavior.
Browser fixtures verify snapshot IDs on ordinary builds and Captain comparisons,
format switching and saved-build preservation. They do not verify live provider
feeds or the authenticated production page.
