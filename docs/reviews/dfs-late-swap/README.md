# Exact-slot late-swap planning review

Baseline: merged phase 7, `985567543c7692332cbd1ce5cc764ee56f215bf4`.
Scope: read-only DraftKings NFL Classic comparisons on explicitly supplied
accepted-entry, rule, catalog, lock and projection snapshots. All review fixtures
are synthetic. No provider account, live entry, production database or purchased
data is used.

The [package contract](../../DFS_LATE_SWAP_PACKAGE.md) describes bounds, exact
slot semantics, sources, target precedence and solver claims. Started WR1,
WR2, WR3 and FLEX assignments remain distinct. Original salary is consumed;
already-started newcomers cannot be added. Native exposure limits include
started players, and separate accepted entries may share a roster. Unknown
or contradictory lock evidence blocks the entire import.

The internal CSV dry run accepts the original supplied template and rechecks
its selected entry/contest IDs, exact baseline DFS IDs and ordered columns.
It preserves unrelated rows and metadata and independently audits the proposed
slots. No product UI or public endpoint exposes its CSV. The existing pre-lock
download guard is retained.

DraftKings' current primary guidance says late swap is contest-dependent,
athletes cannot be added or removed after their game locks, and the resulting
lineup must still meet contest requirements. Sources checked October 12, 2026:
[entry/edit closing times](https://support.draftkings.com/dk/en-us/when-do-lineup-entries-and-edits-close?id=kb_article_view&sysparm_article=KB0010806)
and [late-swap availability](https://support.draftkings.com/dk/en-us/how-do-i-late-swap-a-player?id=kb_article_view&sysparm_article=KB0010830).
These general articles are not an authenticated rule contract or lock feed for
an imported contest; the source specification imposes exact-slot immutability.

## Release gates

| Capability | State |
|---|---|
| Supplied-snapshot exact-slot planning | Implemented; scoped verification recorded below |
| Synthetic API → plan → original-template CSV replay | Internal engineering check only |
| Authenticated accepted-entry readback | Unavailable; imported declarations cannot establish acceptance or ownership |
| Verified current platform locks | Unavailable; imported decision times are historical declarations |
| Conditional remaining-game/field evaluation | Unavailable; only supplied unstarted-player input sums are compared |
| Platform-ready late-swap CSV / entry submission | Gated; no product export or submission path |
| Calibrated football/field/return recommendation | Unavailable; earlier phases' forward-data gates remain open |

Hashing a supplied file proves content identity only. Permission flags are
declarations, not a verified license. The personal JSON retains original inputs
and a versioned exact-slot proposal without changing collection or submission
history. A fresh account-access check precedes that download.

## Actual verification

| Check | Result |
|---|---|
| Affected DFS / lineup / Vegas backend regression | 1,263 passed, 1 existing warning, 109.30 s |
| Final late-swap engine, API and independent oracles | 192 passed, 1 existing warning, 7.18 s |
| Repository instruction checks | 13 passed, 2.29 s |
| Full frontend regression | 1,240 passed / 3 failed of 1,243, 18.315 s |
| Focused DFS and layout regression | 313 passed, 17.663 s |
| Final production build | PASS, 10.16 s; existing bundle-size warning |
| Existing phone export/recovery smoke | PASS at 390, dark; sealed CSV and exact worker recovery |
| Production-component browser tasks | PASS, 10 width/theme cases, 30 layout states, 9 guard groups |

The broad backend run preceded the last isolated timestamp/version-manifest
changes and test additions. The final 192-test run covers those changes; these
overlapping runs are not added together. No fresh whole-repository backend or
paid ready-for-review CI result is claimed. The existing Starlette warning is
the `BlockingPortal` deprecation. One sandbox test attempt could not create its
temporary fixture directory; the authorized isolated rerun passed.
The installed Windows Node runner did not discover the `npm test` directory
argument. The final full regression explicitly enumerated all frontend test
files plus `scripts/dev/layout_audit.test.mjs`; no tests were excluded.

All three full-frontend failures were independently reproduced on the exact
unchanged baseline `985567543c7692332cbd1ce5cc764ee56f215bf4`:

- `auctionAwardContractLabel describes locked rookie and vet deals`
- `accuracy copy names the miss, not a trust slogan`
- `My team keeps the approved summary above a flat roster`

They concern existing contract/copy/banner expectations outside this change.
The tests were not weakened. Raw local logs remain under `outputs/` and are not
committed.

The [engineering receipt](engineering-receipt.json) pins the final measured
source hashes and NumPy/SciPy versions. Its synthetic maximum-bound case has
150 accepted-entry declarations, 600 supplied alternatives, 750 catalog players
and 300 started slots; the complete request is 318,284 bytes. All ten checks
passed, including exact slots, locked appearance counts, hard player/pair bounds,
target counts, original metadata and unrelated rows. This single local run
measured 0.579 s for the preview helper, 2.692 s for the planning helper and
1.336 s for the internal CSV dry run while other local checks shared the host.
These are not latency percentiles; peak memory and hosted performance were not
measured. The MILP result is a complete audited candidate-pool proposal with a
numerical zero gap, not an exact or full-universe optimality proof.

## Layout and task review

The [browser receipt](browser-receipt.json) records the actual production
components and workers with engine-generated synthetic responses. All network
requests were intercepted in an isolated browser fixture; this does not verify
a live account, provider, hosted application or accepted platform entry.

| Width | Light | Dark | States |
|---|---|---|---|
| 320 | PASS | PASS | Closed, proposal, details |
| 390 | PASS | PASS | Closed, proposal, details |
| 768 | PASS | PASS | Closed, proposal, details |
| 1280 | PASS | PASS | Closed, proposal, details |
| 1440 | PASS | PASS | Closed, proposal, details |

The checks cover horizontal overflow, aligned controls, spacing/collisions,
readable type and target sizes. Desktop and phone screenshots were visually
inspected after the final spacing changes. The compact panel keeps the facts in
two columns on a phone and exact-slot/source/method detail closed initially.
The subsequent malformed-audit response guard changes only the error message;
the final focused/full frontend checks and production build cover that change.

- Desktop: [light](panel-proposal-1280-light.png), [dark](panel-proposal-1280-dark.png)
- Phone: [light](panel-proposal-390-light.png), [dark](panel-proposal-390-dark.png)

Behavior checks cover keyboard opening and result focus; failed/mismatched
response retention; unknown locks blocked before upload; actual-engine rejection
of a started WR-to-FLEX move; cancellation/elapsed time; fresh download-access
denial; stale-context responses; and clearing private inputs after an account
change. The personal download matches the frozen input and proposal. Existing
history remains unchanged. The 390 export/recovery smoke also exercised the
existing Build → Review → Download flow.

Other Fantasy, Projections and Results surfaces were not visually rechecked in
this phase. No real-user task acceptance, hosted performance, authentic
accepted-entry readback or live lock-feed verification is claimed.
