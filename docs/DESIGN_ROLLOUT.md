# ScoreSense design rollout

October 16, 2026 · execution record · `codex/design-rollout` from `develop` (`eb700d2f`)

[PRODUCT.md](./PRODUCT.md) is the design authority. This record tracks the user's full-page rollout request, page briefs, demonstrated changes, and evidence. Existing approved designs carry forward. A queue entry is not a claim that a page has a defect or has passed review. Delivery uses an isolated branch from current `develop`. The original working checkout and its unrelated edits remain intact; only this task's remaining changes were ported. Earlier local-review evidence is historical and is distinguished below from checks on this branch.

## Responsibilities and instruction routing

| Owner | Responsibility |
|---|---|
| PRODUCT | Product/brand/design authority, concise decision standard, approvals, accessibility baseline |
| AGENTS + always-applied core rule | Route conceptual and implementation requests, including requests with no source attached; explicit reading checkpoint |
| Frontend craft | Observable composition, grouping, alignment, type, controls, states and responsive checks |
| Fantasy + mobile rules | Domain-specific composition, current navigation, phone controls and approved exceptions |
| Performance rules | Snapshot/caching/media/polling ownership, perceived-speed checks and future field targets |
| Matching / mocks / verification skills | Resolve → inspect → brief → bounded change or focused options → implement → verify |
| Living surface registry | Canonical source/copy/dependency/route/chrome mapping, including supporting entry flows |
| This record | Page queue, concrete briefs, changes, evidence and outstanding work |
| Legacy pointer / Bugbot | Retain compatibility routing and existing runtime-review/budget scope |

Reconciliation against the current source, rather than the older planning snapshot:

- Trades already uses the October 15 approved compact shared hero and desk. Generic craft copy now names Review trade/Propose trade rather than the old Continue step.
- Home and This Week follow the October 16 approved consolidation: one `LeagueHome.jsx` landing destination, canonical `home` and `/hub/home`, with `/hub/week` preserving query/hash through its compatibility redirect. Lineup actions belong to My team. My team room swaps remain temporary previews.
- `hubOfficeTabs.js` contains Contracts or non-contract Roster moves, Salary sheets, Corrections, Members, Access & imports. The planned Roster moves slug/serialization fix is already upstream; its existing route contract is preserved. Current Cap workbench, searchable Corrections editor, Appearance providers, palettes, and route round-trip contracts carry forward.
- Existing compatibility and review routing retains its responsibility. No second rules system or review-budget migration is introduced.
- Existing approved refinements do not need another mock pick. New unapproved layouts/overlays use focused options as specified by the mock skill.
- Screenshot availability is capability-based. Requested 320/1024 audit widths are now preserved; invalid widths fail explicitly and all phone widths use the 44px target floor.
- Historical review proposals remain history. Later PRODUCT approvals win; [FANTASY_MOBILE_REVIEW.md](./FANTASY_MOBILE_REVIEW.md) now points here for current work.

## Acceptance and evidence

For each substantial pass, record task; approved baseline; attention order; observed friction; bounded change and reused components; behavior/data/permission invariants; relevant states, viewports and checks. Accept a page when its relevant journey works, its applicable layout checks pass, and its rendered screenshots have been inspected. Do not force a cosmetic change on a page without demonstrated friction.

Keep these evidence types separate:

| Evidence | Establishes | Does not establish |
|---|---|---|
| Machine | Named tests/build/implemented layout checks at exact widths | Overall visual quality, WCAG conformance, field performance |
| Visual | Named screenshots actually inspected, with theme/state/width | Hidden interactions or unseen variants |
| Task | Exercised control and observed result | Other permissions, hosts, phases, or data sources |

Base viewports: 390 and 1280. Add actual 320 and laptop widths for long content, headers, columns and fixed actions. Review applicable keyboard/focus/menu/dialog behavior, blockers, loading/empty/error/stale/locked/read-only/unsaved states, both themes, reduced motion, and salary/pick/native/Sleeper distinctions. Use fixtures for mutations; read-only local-route inspection uses the existing snapshot and blocks writes and external requests. Public token routes require a concrete fixture token; invalid-link renders cover only that state. Never send recovery mail, make a proposal, join a real league, or publish a real room merely to verify UI.

Reference standards: [WCAG 2.2](https://www.w3.org/TR/WCAG22/), [Core Web Vitals thresholds](https://web.dev/articles/defining-core-web-vitals-thresholds), and [Cursor rules](https://cursor.com/docs/rules). Accessibility is an engineering baseline, not a current conformance claim. LCP ≤2.5s, INP ≤200ms and CLS ≤0.1 at the 75th percentile are future field targets, not current measured results.

## Page queue and briefs

IDs below resolve to files and routes in `frontend/src/livingSurfaces.js`; do not maintain a second route map here. Supporting parameterized pages record `routePattern` and need concrete fixture context. The registry currently contains 45 surfaces (38 upstream rows plus seven supporting entries); office/live/overlay compatibility rows intentionally share some implementation and URLs.

The full 45-surface source/brief queue and initial working-snapshot review are complete. The remaining implementation has been reconciled against newer upstream approvals; branch-specific checks and verification boundaries are recorded below. Each attention sequence states what should lead, what constrains it, and the relevant next action/detail. Per-page acceptance also includes the shared evidence criteria above.

| Surface ID | Task and approved baseline | Attention order / acceptance focus |
|---|---|---|
| `hub.trades` | Assemble and review an exchange in the October 15 A desk | Package → relevant impact → Review/Propose; current verdict, one phone selection state, versions/undo, bounded package bar |
| `hub.home` | Orient in the October 16 B clubhouse | Matchup → conversation/standings → unresolved attention; same week, phase-aware pre-draft action |
| `hub.week` | Compatibility entry to the consolidated Home / This Week landing | Preserve selected week/query/hash through redirect; Review lineup opens My team; no separate navigation destination |
| `hub.roster` | Inspect Room, Lineup and Manage roster within approved room | Selected player → lineup/roster context → legal action; preview resets, missing forecasts, owner-only changes |
| `hub.available` | Scout and acquire through compact list/details/bid flow | Identity/forecast scale → restrictions/cost → Add/Bid; locked window, personal ceiling, preserved failed input |
| `hub.game` | Follow approved player-spotlight matchup | Score/forecast → selected duel → starters/league detail; selected team/week, live/final/baseline truth |
| `projections.weekly` | Scan the approved tier board | Rank/player/P50 → range/context → compare/inspector; aligned numbers, filters, phone windowing |
| `projections.season` | Compare approved preseason/live-season boards | Timeframe → forecast/recorded production → details; remaining-season estimates stay distinct |
| `projections.inspector` | Inspect approved C centered popup/phone sheet | Headline and timeframe → game log → disclosed explanation; focus containment/return, no invented baseline |
| `hub.planner` | Preview a move on the approved cap sheet | Move → current/preview consequence → next action/revert; season filters, clear obligations, no bid write |
| `hub.rosters` | Browse approved table/details league directory | Manager → roster/value comparison → selected player; adjacent salary/estimate/delta, bounded pagination |
| `hub.insights` | Read saved league stories and comparisons | Story → comparison → detailed evidence; period/owner identity, missing/legacy history, explicit refresh |
| `hub.vibes` | Record personal Higher/Lower judgment | Portrait/player → judgment → undo/progress/ranking; gesture/keyboard parity and research labels |
| `tools.dfs` | Build, review, download, inspect Results in approved workspace | Slate/count/goal → built collection → exact export/results; preserve frozen inputs and distinct exports |
| `hub.value` | Make Strategy face-offs on board-first surface | Same-position choice → personal/site order → queue; no experience hero or cap spreadsheet |
| `hub.room` | Progress calendar → locked night → seats → entry | Draft-night state → readiness → appropriate entry; closed-calendar fallback, no repeated cards |
| `hub.room.live` | Nominate/bid in approved live room | Nominee/clock/bid → budget/slots → Nominate/Bid/queue; pause, stability, reduced motion |
| `tools.mock-draft` | Launch practice and inspect recent mocks | Rules/field size → seats/readiness → launch; chosen league rules, recent-mock rail |
| `tools.mock-draft.live` | Practice in shared live room and read recap | Nominee/clock → budget/queue → bid/recap; no Drop/Trade, Discard retained, real pricing path |
| `tools.best-ball` | Scan position ranks/ECR/edge and export | Rank/player → consensus/edge labels → filters/export; No ECR, useful density, honest data |
| `hub.rules` | Read/edit selected league rules | Category → grouped fields/preview → Save/Discard; form league, host/role restrictions, dirty/error retention |
| `hub.setup` | Read setup and connection readiness | Current status → missing requirement → correct existing destination; no duplicate sync or focus write |
| `hub.create-join` | Use existing account-aware create/join dialog | Account/league context → fields/import preview → create/join; pending/error and modal focus |
| `hub.office` | Navigate permission-gated staff workspace | Current pane → relevant league task → pane action; preserve alias/deep-link behavior |
| `hub.office.current` | Manage contracts and roster moves | Player/contract → financial/roster effect → staged/immediate action; phase and salary format |
| `hub.office.rosters` | Assign/drop players in non-contract leagues | Team/player → roster-space consequence → confirmed move; no money/years, immediate drop in every phase, existing deep links |
| `hub.office.historic` | Review/import salary sheets | Selected sheet → edit/preview → publish; unmatched rows, reasons, retained failure state |
| `hub.office.corrections` | Repair a historical week with audited preview | Selected week → proposed correction/reason → preview/publish; past snapshots and current roster preserved |
| `hub.office.members` | Manage capacity and identities | Capacity/claimed managers → selected person → invite/remove; seat versus manager, explicit consequences |
| `hub.office.access` | Inspect links/imports and advanced controls | Connection state → account/league/import task → preview/confirm; import ownership and destructive boundaries |
| `account.account` | Edit bounded Account/Appearance choices | Current choice → unsaved preview → save/revert; both themes, reduced motion, failure preservation |
| `account.report` | File a bug through existing form | Useful fields → validation/context → progress/completion/return; fixture writes only |
| `account.model` | Read Model accuracy | Period/sample → comparison → legend/detail; missing-data states and no false precision |
| `account.admin` | Inspect Overview/Users/Leagues | Actionable diagnostic → aligned evidence → explicit action/progress; permission-aware, fixture mutations |
| `account.login` | Sign in through existing standalone form | Identity/provider → fields/feedback → safe return; pending/error/keyboard access |
| `account.register` | Register through existing standalone form | Provider/account fields → consent/validation → completion; fixture writes and safe return |
| `account.auth-callback` | Complete transient sign-in return | Pending → validated local return → destination; fixture tokens, no token disclosure |
| `account.verify` | Confirm email status | Pending/success/error → consequence → return; fixture-only verification |
| `account.forgot-password` | Request account recovery | Email → pending/validation → confirmation/return; no real recovery email |
| `account.reset-password` | Set a replacement password | Link validity → matching fields → completion; token-safe, failed input retained |
| `account.privacy` | Read public Privacy | Reading width → heading hierarchy → relevant consent links; keyboard/readability |
| `account.terms` | Read public Terms | Reading width → heading hierarchy → relevant consent links; keyboard/readability |
| `account.sms-alerts` | Review opt-in content | Consent grouping → frequency/vendor/privacy → voluntary opt-in; unchecked default, no real enrollment |
| `public.team-room` | Visit approved read-only shared room | Owner identity → room/selected player → safe return; loading/invalid/empty, private data omitted |
| `public.lobby` | Enter member/practice lobby | Room identity/status → membership/readiness → permitted entry; invalid/full/errors, saved focus preserved |

### Trades pilot brief

Task: build a package while understanding current roster, cap and private weekly PPR impact, then review and propose the exact validated terms. Baseline: October 15 A desk, Build/Discover/Ideas/Inbox, compact shared hero, seven initial rows per roster and View all, persistent package bar, Send/Receive/Impact sharing one package on phone. Attention: package → relevant consequence → Review trade.

Inspect the current rendered builder, selected package, versions/undo, multi-team recipients, Advanced terms, Full impact, review, linked execution, and errors at 390/1280 plus actual 320/1024. Reuse `LeagueTrades`, its existing presentation/helpers, shared focus handling, media helpers and `trade-desk.css`. Keep current server verdict adjacent to and gating Review/Propose. Preserve notes during editing, current roster salary including expirees, dead-cap provenance, private weekly estimates, honest missing/offseason data and separate Sleeper cap review. No fairness/acceptance statistics, chart libraries, extra polling, live inference or implicit sync. Any change must follow observed friction; initial findings/evidence are recorded below.

### DFS substate brief

Within `tools.dfs`, inspect Build (slate/count/goal), Review (actual built/unique counts, selected lineups, appearances), Download (exact export and validation), Results (actual fees/payouts/results/completeness), and research/recovery disclosures. Preserve build-time snapshots, reserved-entry metadata and explicit assignment review, import preview/progress, unknown values, backups and restoration. Do not claim an export was exercised from inspecting the Build page alone.

## Changes delivered on this branch

| Owner | Observed friction / result |
|---|---|
| Instruction routing | Broad design requests now receive an essential checkpoint even without an attached file. PRODUCT is read explicitly; requirements, defaults and approved exceptions are distinguished. Generic Trades chrome guidance now agrees with its approved compact shared hero. |
| Registry | Seven supporting entries cover sign-in return, verification, recovery/reset, shared rooms, lobby entry and create/join; shared session dependencies and aliases resolve existing implementations. |
| Shared controls and theme roles | Phone buttons and league form fields use the existing 44px floor; Cap money labels use the same height role. Telephone inputs receive shared field styling. Hero and draft/DFS accents use the active theme's roles. |
| Entry and standalone pages | Sign in, practice and browse/create disclosure triggers use their secondary tier. Session, standalone, public lobby and shared-room chrome has a keyboard skip destination and main landmark. |
| Create/join | Reuses `useModalFocus` for containment, Escape, background inertness and return; explicitly typed text inputs and a responsive field group retain the existing form. |
| My team lineup | Empty/error board owns its next action; suppress the duplicate rail action and let the message take layout space. Existing selected-call and eligible-bench picker behavior remains. |
| Salary sheets / Corrections | Numeric/action columns stay compact, positions center, and the correction reason has a stable accessible name. Retain the newer searchable Corrections editor and its own styles. |
| Draft | Offline fields/menu/actions use shared heights. The phone practice rail retains a relative containing block for its decoration without becoming sticky. |
| Layout audit | Preserve exact positive integer widths and apply phone targets through 768px. Explicitly set reused-context viewport, bound readiness and report unfinished loads. Exclude skeleton/header-only/card tables and classify position/missing glyphs without suppressing genuine empty-column defects. Existing cursor, inset, menu and locker checks remain. |
| Browser fixtures | Use production phone chrome for Rosters, actual theme bootstrap for headers, compact DFS import query handling and current results-table selectors for the large import check. |

Several initial refinements were already upstream and therefore are not duplicated: mobile projection metrics, shared panel theme mapping, explicit Account field types, current Cap composition and current Corrections preview formatting. The rollout preserves approved layouts and changes shared owners only where demonstrated friction remains.

## Current branch verification

Checks below ran in the isolated checkout, rather than against the original mixed working snapshot.

| Machine gate | Result / scope |
|---|---|
| Frontend unit tests | **1,271 PASS**, zero failures; all `frontend/src/**/*.test.js` plus `scripts/dev/layout_audit.test.mjs` explicitly enumerated. The existing `npm test` directory argument fails to resolve `src` on this Windows Node 24 host; the equivalent explicit file run passed. |
| Python product/registry | **37 PASS**: `tests/test_product_constitution.py`, `tests/test_living_surfaces.py`; `PYTHONPATH=.` and workspace-local `--basetemp`. This is not the full backend ready gate. |
| Full backend merge gate | **4,068 PASS, 2 skipped**, 7 dependency deprecation warnings; full `pytest tests/ -q` with workspace-local temp files. Backend source was unchanged by the review fixes. |
| Production frontend build | **PASS**. Existing large-chunk warning remains. |
| Real-DOM layout audit regression | **PASS**: grouped headers/footer, missing values, skeleton/header-only/card exclusion, genuine column-gap detection, unfinished background load and a reused 390px context. |
| Production standalone browser | **52 layout audits PASS**, 1280/390, light/dark and reduced motion. Account, Report, SMS, register/login, recovery/reset, Terms/Privacy. Synthetic account failure retains edits, delete disclosure expands, SMS consent gates the request, and the report menu works. |
| Create/join browser | **6 PASS**, 320/390/1280 in both themes: repeated Tab stays inside, background is inert, Escape returns focus, fields meet target heights, dialog fits viewport and failed creation preserves input. Synthetic failure only. |
| Appearance hero browser | `node scripts/dev/hero_theme_browser.mjs`: **20 scenarios PASS**: Classic, Cozy den, Snowfall, Autumn, Footballs at 1280/390 in light/dark. Both shared and Rules heroes retain painted theme surfaces; reduced motion and overflow checked. |
| DFS large import browser | **PASS at 1280/390**, real production worker: 6,001 entries / 5,489,838 bytes, synthetic interruption and idempotent retry in nine batches, 50-entry pages. Uses the current results table; no missing season-helper dependency. |
| Trades browser workflow | **PASS at 320, 390, 1024, 1280**: current desk selection/validation/review, notes, lazy requests/reuse, three-way routing, partial dead cap, linked Sleeper/unavailable states and modal focus. No real proposal is sent. |

Current component fixtures: **124 layout audits PASS** (26 named renders at 1280/390 in both themes, plus Trades/Rosters/Rules/Cap/Salary sheets at 320/1024 in both themes), no runtime errors or unfinished renders. Fixtures render production components with synthetic data and blocked external requests. The retired mobile Home fixture and old site-polish interaction selectors were not used; Home uses the current consolidated fixture. These are component-layout checks, not a complete application-route audit or proof of hidden states. Raw ignored evidence stays in `outputs/design-rollout-current/`, `outputs/trades-layout.json`, `frontend/qa-dist/form-alignment/` and the original checkout's `outputs/design-rollout/port/`. The source, reusable regression, this record and selected screenshot evidence are delivered.

### Inspected screenshot evidence

Selected current-branch captures below use synthetic data and reduced motion; they show the named state only. The create/join failure is deliberate to verify retained input. Full-size inspection covered these captures and Salary sheets phone / Cap desktop; the shared contact sheet covered Home, Trades, Salary sheets, Cap, Rules and Rosters. Remaining captures have machine checks and are not all individually visually reviewed.

| State | Capture |
|---|---|
| Create/join, failed creation, 390 light | [Phone dialog](./reviews/design-rollout/create-join-phone-light.webp) |
| Create/join, failed creation, 1280 dark | [Desktop dialog](./reviews/design-rollout/create-join-desktop-dark.webp) |
| Account, 390 light | [Account form](./reviews/design-rollout/account-phone-light.webp) |
| Dark Appearance palette regression, isolated hero styles, 390 | [Theme contact sheet](./reviews/design-rollout/hero-dark-palettes.webp); functional pages are represented only by their shared/Rules hero primitives |
| Populated Salary sheets, 1280 light | [Salary table](./reviews/design-rollout/salary-desktop-light.webp) |

## Historical working-snapshot review

Before isolating the delivery branch, the original local snapshot received the complete page-family pass: 37 concrete registry routes at 1280 and 390, both-theme screenshot inspection, 34 catalog scenarios / 68 renders, inspector tab/state checks, shared-table variants, supporting entry/admin/correction states, native/practice draft, and DFS workflow/import exercises. Its gates were 843 frontend tests, 69 targeted Python tests, production build and real-DOM regression PASS.

Those results belong to that mixed snapshot on `codex/dfs-matchup-weights`; they are not validation of newer upstream implementations. Its task-only patch, before snapshots, fingerprints, reports and contact sheets remain in the original checkout's ignored `outputs/design-rollout/`. Some proposed fixes became unnecessary after porting to current `develop`. In particular, the later Home/This Week consolidation, Cap workbench and Corrections editor supersede historical separate-page screenshots and selectors. Current branch checks above take precedence.

## Verification boundaries and delivery

- The source/brief queue covers all 45 registry entries, including compatibility and overlays. A registry entry is not proof of every role, phase, data source or hidden state. Browser checks name their actual routes and fixture variants.
- The older full DFS workflow harness targets superseded disclosures/export controls; it remains upstream unchanged and did not complete on this branch. Current large-import checks above passed; historical export evidence above is not current-branch evidence.
- Synthetic fixtures establish the named populated/permission states. Real Cap cut/extension writes, admin mutations, live imports/publication, enrollment, recovery email and production league writes are unexercised. No deployment is part of this rollout.
- This is not WCAG conformance or field-performance certification. Shared targets, labels, landmarks, selected keyboard/modal tasks and theme renders were checked. Full assistive-technology, contrast and zoom/reflow review and field Core Web Vitals measurement remain separate.
- Three fresh Cursor-chat probes remain manual: conceptual Trades planning without an attached file, a `LeagueTrades.jsx`-attached edit, and a backend-only task. Source/frontmatter/path tests cannot establish actual Cursor rule activation.
- Delivery began as a scoped draft PR against `develop`. The user subsequently authorized review, fixes and merge after passing checks. The full local gate above passed; remote CI and review must also pass before merging. Release remains outside this task. The original checkout's unrelated work is preserved.
