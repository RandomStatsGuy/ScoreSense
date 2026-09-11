# DFS tool review — September 11, 2026

Scope: `/tools/dfs`, large-field NFL tournaments, DraftKings uploads and personal results. **The user approved A, the portfolio workspace, plus Results.** Account-controlled backgrounds remain unchanged. Mockup and browser fixture data is illustrative.

## What the evidence supports

**Optimize for the contest payout.** Haugh and Singal model opponents' roster choices and maximize expected contest reward rather than just projected score. Their NFL experiment used 2017; the authors caution that one season's high variance limits empirical conclusions. This supports modeling opponents and payouts, not a universal Showdown recipe. [Author manuscript](https://www.columbia.edu/~mh2078/DFS_Revision_1_May2019.pdf), [published paper](https://doi.org/10.1287/mnsc.2019.3528).

**Build entries together.** Hunter, Vielma and Zaman construct portfolios using expected score, a lower bound on variance and an upper bound on correlation across entries. Their empirical applications concern baseball and hockey. Exposing lineup relationships and portfolio concentration is a useful design inference; an NFL implementation still needs validation. [Picking Winners in Daily Fantasy Sports Using Integer Programming](https://arxiv.org/abs/1604.01455).

Neither study establishes “always leave $X,” “always Captain a running back,” or “lowest ownership wins.” A hindsight winning lineup is not a reproducible pregame strategy. More projections, diversification or controls alone do not establish positive expected returns.

## Implemented: A + Results

| Finding | Implemented response |
|---|---|
| Summed P50/P10/P90 values are not contest returns or joint lineup quantiles | Accurate objective help; no invented win rates, duplication probabilities or predicted ROI |
| Projection jitter is not joint game simulation | Explicit projection-variation control and explanation |
| Captain concentration differs from total exposure | Captain lock, individual Captain caps, Captain exclusion retaining FLEX eligibility, and actual Captain/total usage |
| Missing kickers and fixed DST estimates hide coverage gaps | Missing/fixed/imported labels; validated ID-based projection imports; incomplete estimates excluded from builds |
| Game choices can silently change unrelated settings | Explicit stack, bring-back, team limit, salary range and diversity controls; notes do not change projections |
| Lineup CSVs cannot assign reserved entries | Separate My Lineups and Edit Entries paths |
| No personal results ledger | Account-scoped cash history and score imports, spend/payout chart, weighted ROI, saved-build comparisons and postgame notes |

A uses a compact title/slate bar, settings rail, paginated player pool, selected lineup and portfolio list. Option B remains a design alternative, not the implemented builder.

Exposure caps use the requested count and round down. A constrained build may stop early; actual count and exposure are visible. Locked players are exempt from the general exposure cap; conflicting Captain-specific limits still block a build. Imported ownership is displayed and saved, but is not an optimizer penalty or calibrated duplication estimate.

Opponent simulation, contest-return optimization, an automatic ownership feed and trained K/DST models remain future work. DST's existing fixed 7/4/11 inputs are now explicitly labeled; users can replace them with imported estimates.

## Export fixes

- Preserve CSV identifiers as text, including alongside blank IDs.
- Never substitute a global athlete ID for a missing DraftKings draftable ID, or a FLEX ID for a missing Captain ID.
- Keep Captain-only rows without inventing FLEX IDs.
- Validate every lineup: exact roster slots, names, numeric DraftKings IDs, duplicate athletes/IDs, valid salaries, salary cap, two-team Showdown and the 500-lineup limit.
- Compare roster-specific IDs and salaries against the loaded player pool, which includes folded Captain/FLEX records.
- Import the official Edit Entries template, preserve entry/contest IDs and other metadata, explicitly assign lineups, and retain unassigned rows.
- Check the template's eligible-player catalog when present. When absent, require review of slate/start time; numeric IDs alone cannot establish contest eligibility.

DraftKings documents desktop lineup uploads for one sport, format and start time, followed by assignment to eligible entries. Reserved-entry editing is a separate workflow. ScoreSense now names those paths separately. [Official upload and editing instructions](https://support.draftkings.com/dk/en-us/how-do-i-upload-or-edit-multiple-lineups-at-once?id=kb_article_view&sysparm_article=KB0010800).

Exporting assigned entries also saves the build link and marks those entries unsettled for later history matching. No entry IDs are manufactured and no contests are entered automatically.

The reported **“account restricted” remains unresolved**. Successful upload and support saying the account is unrestricted do not establish which subsequent check failed. Exact message, contest/draft-group IDs, time and workflow are needed for a targeted support follow-up. No paid entry was attempted; export validation cannot determine account eligibility.

## Results and postgame review

Two mapped CSV imports serve different purposes: cash history supplies fees/payouts; lineup results supply scores, ranks and lineup text. Matching uses site + contest ID + entry ID. IDs remain strings. Reimports update the same entry and score-only imports preserve existing money fields. Preview before saving, reimport corrections or remove entries. The source CSV stays with the user; raw upload receipts are not persisted.

- **Fees/payouts:** settled cash entries with both amounts known. Payout means actual credited cash prize, including splits, not net profit or the headline prize. Exclude tickets, refunded and promotional entries from this cash import.
- **Net:** payouts minus fees, using integer cents.
- **ROI:** total net divided by total fees, not an average of entry percentages. Unavailable with zero fees or incomplete settled financial data.
- **Chart:** cumulative fees and payouts by imported date. Undated, incomplete and unsettled/void coverage is visible.
- **Groups:** Captain, saved QB/pass-catcher stacks, salary left and contest, with counts and fees. These describe the imported entries rather than establish causal strategy rankings.

Saved builds retain original lineup projections, available source labels, imported ownership, settings, timestamp and build notes. This is a **build-time snapshot**, not proof it was captured before kickoff. Entry review compares actual total points with the saved projection sum, flags missing snapshots and keeps postgame notes separate. Historical forecasts are never recomputed using today's model.

Per-player error attribution, field-size/entry-limit segmentation, source publication timestamps and pre-lock capture enforcement require more data. A future player-error report must deduplicate repeated player/slate observations or label exposure weighting. Any contest-return model needs held-out slates, pre-lock inputs, actual fees/tie payouts, a comparable projection-only baseline and uncertainty across slates. Personal entries are not a representative sample of the entire field.

## Previews and verification

- [A — Portfolio workspace](mockups/dfs-gpp-a.html)
- [B — Game-script alternative](mockups/dfs-gpp-b.html)
- [Results dashboard](mockups/dfs-gpp-results.html)

The interactive fixture `/test-fixtures/dfs-workspace.html` uses real React components with illustrative data. Browser checks exercise projections, Captain controls, snapshots, both downloads, assignment, idempotent history imports, notes and empty/loading/error/sign-in states. Build and Results layout audits cover 1280px and 390px. 85 JS tests and 60 Python tests pass, covering CSV/financial calculations, salary joins, optimizer controls, API wiring, account isolation and immutable references. The production Vite build passes. Personal results persist in `data/dfs/results.db` (git-ignored); preserve this file with application-data backups.

Run frontend Vite, set `DFS_PREVIEW_URL` if different from `http://127.0.0.1:5176/test-fixtures/dfs-workspace.html`, then run `node scripts/dev/verify_dfs_workspace.mjs` and `node scripts/dev/verify_dfs_workflows.mjs`. Screenshots/audit JSON go under `outputs/dfs-gpp-review/`.

Production data, the user's actual history file and paid DraftKings entry were not tested. This change is not deployed and does not claim improved tournament returns.
