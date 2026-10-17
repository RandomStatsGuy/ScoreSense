# ScoreSense design rollout

October 16, 2026 · execution record · `codex/design-rollout` from `develop` (`eb700d2f`)

[PRODUCT.md](./PRODUCT.md) is the design authority. This record tracks the user's full-page rollout request, page briefs, demonstrated changes, and evidence. Existing approved designs carry forward. A queue entry is not a claim that a page has a defect or has passed review. Delivery uses an isolated branch from current `develop`. The original working checkout and its unrelated edits remain intact; only this task's remaining changes were ported. Earlier local-review evidence is historical and is distinguished below from checks on this branch.

## Overall completion status

The original project has two parts: strengthen the AI design instruction system, then inspect and improve the full page inventory against it. The implementation pass is merged; final acceptance remains open. The 45-surface source/brief queue and initial working-snapshot review do not establish current visual/task completion for every page. Status reports should use this whole-project scope and the evidence boundaries below.

| Original workstream | Current state | Remaining acceptance work |
|---|---|---|
| AI design guidance and workflow | Rules, skills, PRODUCT, agent routing and documentation changes merged in #765 | Three fresh Cursor activation probes: conceptual Trades, attached Trades source, backend-only task |
| Full page inventory and initial review | 45 surfaces mapped and briefed; initial page-family review complete | Reconcile current-page evidence where it is still historical or only machine checked |
| Implementation and focused follow-ups | #765, #767, #769, #771, #773, #775 and #777 merged; preserve approved designs and fix demonstrated friction | Confirm and address findings from the remaining acceptance checks |
| Current visual and task evidence | Named Trades, standalone/entry, Appearance, DFS, draft-room, draft-tools, Rules/setup and Cap/Rosters/My team checks recorded below | Complete remaining relevant page/state, keyboard, contrast/reflow, host/role and read-only live-route checks; inspect the remaining captures explicitly |
| Final project closeout | Open | Reconcile this acceptance checklist against the original request, report unresolved evidence and complete the authorized delivery process |

Field Core Web Vitals remain future measurement targets from the plan. Neither their target values nor fixture timing should be reported as measured production performance.

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
- The older full DFS workflow harness did not complete on #765 because it targeted superseded disclosures/export controls. The follow-up below replaces that harness and records current export evidence separately. Historical working-snapshot evidence remains historical.
- Synthetic fixtures establish the named populated/permission states. Real Cap cut/extension writes, admin mutations, live imports/publication, enrollment, recovery email and production league writes are unexercised. No deployment is part of this rollout.
- This is not WCAG conformance or field-performance certification. Shared targets, labels, landmarks, selected keyboard/modal tasks and theme renders were checked. Full assistive-technology, contrast and zoom/reflow review and field Core Web Vitals measurement remain separate.
- Three fresh Cursor-chat probes remain manual: conceptual Trades planning without an attached file, a `LeagueTrades.jsx`-attached edit, and a backend-only task. Source/frontmatter/path tests cannot establish actual Cursor rule activation.
- Delivery began as a scoped draft PR against `develop`. The user subsequently authorized review, fixes and merge after passing checks. The full local gate above passed; remote CI and review must also pass before merging. Release remains outside this task. The original checkout's unrelated work is preserved.


## Follow-up: current DFS workflow verification

Task: close the current guided-flow coverage gap after release of #765. Approved baseline is Tools / DFS, Build / Review / Download, followed by the shared Results dashboard. Attention order is build inputs, the actual reviewed set, the exact entry-update file, then descriptive results. The old full-workflow checker stops at controls now inside closed disclosures and uses superseded export and ledger selectors; that is a demonstrated verification gap, not evidence of a visual defect.

Bounded change: use the existing isolated DFS fixture runtime, current disclosures and accessible actions, and explicit synthetic access/status/history responses. Verify both file paths, metadata and untouched reservations, original build inputs, pre-lock/access/status blockers, recovery after failed history sync, and idempotent Results imports at desktop and phone widths in both themes. Preserve the approved layout, original forecasts, export guards, account boundaries and unconfirmed platform acceptance. No live account, contest, provider upload or league write is part of these checks. The results below belong to the follow-up branch based on the merged #765 release.


The current workflow exposed a product defect: `useDfsBuilder` discarded the weekly schedule for Captain formats. Consequently, a Showdown build recorded no known kickoffs and its pre-lock check could not enforce a scheduled start. Captain formats now fetch and retain the existing schedule readout while keeping game weighting disabled. Original build schedules remain frozen; unavailable schedule data still stays explicitly unknown, and platform acceptance remains unconfirmed.

| Follow-up gate | Result / actual scope |
|---|---|
| Frontend unit gate | **1,344 PASS**, zero failures: explicitly enumerated `frontend/src/**/*.test.js`, `*.test.mjs` and layout-audit unit tests. Uses the equivalent file list because the existing Windows Node 24 directory argument fails. |
| Targeted backend contracts | **68 PASS**: API lineup, DFS results, Vegas schedule, product constitution and living surfaces. Provider calls mocked; isolated temp paths. Backend source unchanged; full backend ready gate not repeated for this draft. |
| Production frontend build | **PASS**; existing large-chunk warning remains. |
| Guided Showdown workflow | `node scripts/dev/verify_dfs_workflows.mjs`: **4 full scenarios PASS** at 1280/390 in light/dark. Current user-operated disclosures, keyboard stage/entry selection, imported Captain input multiplied once, two distinct reviewed rosters, saved original settings, both CSV paths and postgame notes. |
| Export and Results contracts | Both download paths preserve reviewed roster IDs. Reserved-entry metadata, leading-zero entry/contest IDs and an unrelated reservation stay intact. Failed optional history sync requires explicit recovery; revoked access blocks recovery; retry downloads identical sealed bytes. Re-import updates the same ledger identity, retaining the saved build link. Exact fixture totals: $605 settled fees, $730 payouts, $125 net, 20.7% ROI. |
| Guard states | **10 scenarios PASS**: loading, empty, error, read-only and known-started at both widths in light theme. The controlled clock advances beyond the frozen kickoff: My Lineups CSV is blocked and reserved-entry download stays disabled. Fresh unavailable-player status and revoked access are also exercised in every full workflow. |
| Component layout | **16 audits PASS**: Build, Review, Download and Results at both widths in both themes. No horizontal overflow, runtime errors or unexpected external requests. Reduced motion enabled. These are isolated production-component fixtures, not live-route verification or accessibility certification. |
| Existing Classic regression | `dfs_flow_tasks.mjs --smoke`: **PASS** at 390 dark, including closed disclosures, exposure conflict, guided build/review/download, sealed CSV and worker backup recovery. |

Inspected synthetic captures: [phone Download](./reviews/dfs-workflow/download-390-light.png), [desktop dark Review](./reviews/dfs-workflow/review-1280-dark.png), [phone Results summary](./reviews/dfs-workflow/results-390-dark-top.png), and [phone selected-entry review](./reviews/dfs-workflow/results-390-dark-selected.png). Raw reports and logs stay in `outputs/dfs-guided-workflows/`.

Production health could not be confirmed: read-only health/version requests failed at TLS connection setup on this host, and the web fetch was unavailable. No production test or mutation ran. Real authenticated app routes, FanDuel variants, other product pages, full assistive-technology/contrast/zoom review, field performance and the three manual Cursor activation probes were not checked in this follow-up. The next batch should address those evidence gaps in scope; this draft does not certify them.


## Follow-up: current draft lobby and room tasks

Task: verify the next page family after merged DFS follow-up #767: draft readiness, nomination/bidding, paused rooms, practice simulation/discard and completed review. Preserve the approved calendar-led lobby and board-first live room. Attention order is night/readiness/entry in the lobby and nominee/current bid/next legal action in the live room. Historical draft captures belong to the old working snapshot; there is no current reusable room browser check upstream.

Bounded change: port the focused production-component fixture and run it through a completely intercepted local runtime. Exercise failed bids while a newer server update arrives, failed availability saves, private queues, pauses and practice recovery. Inspect actual current renders before describing visual defects. Preserve backend authority, private manager queues, real-league focus, salary versus pick rules, disabled paused nomination, and Discard during simulation. No real draft, bid, invite or league write will run. Current findings, validation and captures are recorded below; this branch starts from the merged #767 commit on `develop`.


Observed and fixed:

- A failed bid restored the entire earlier room snapshot even after a newer server bid or nomination phase arrived. The new browser regression failed on the original code with the displayed bid reverting from $20 to $14. Roll back only while the room still holds that request's own optimistic update. Ordinary rejected bids still revert correctly; server updates retain the private viewer queue. Draft errors now announce as alerts.
- Full board did not move focus into its dialog. Reuse `useModalFocus` for initial focus, Tab containment, inert background, Escape and return to the trigger; retain body-scroll restoration through that hook. Full board is a secondary browsing action so Pick remains the primary action.
- Cancelling Simulate could not return focus to the temporarily disabled trigger. Restore focus after the idle state enables the button, without taking focus from another active control.
- The shared roster action primitive rendered a 15px Trade target. Use shared control-height and spacing tokens for 32px desktop and 44px phone minimums, applied to both `DraftRosterPanel` and `DraftTeamCard` consumers. No page-scoped override or new visual language.

| Follow-up gate | Result / actual scope |
|---|---|
| Frontend unit gate | **1,344 PASS**, zero failures: explicitly enumerated `.test.js` / `.test.mjs` and layout-audit tests. Existing Windows Node 24 directory-argument limitation remains. |
| Targeted Python contracts | **105 PASS**, one dependency deprecation warning: draft lobby, availability, mock draft, pick draft, product constitution and living surfaces. Isolated SQLite/temp paths. Backend source unchanged; full backend ready gate not repeated for this draft. |
| Production frontend build | **PASS**; existing large-chunk warning remains. |
| Current browser tasks | `node scripts/dev/draft_room_browser.mjs`: **55 scenarios PASS** using production components and fully intercepted HTTP/WebSocket state. Three rejection cases cover ordinary rollback, newer bid and newer nomination phase. Desktop/phone in both themes exercise successful bids, private-queue retention after public broadcasts, pause/resume UI, nominations, failed availability-save retention and retry, practice simulation/discard, late simulation response after exit, completed native/practice renders and successful snake picks. |
| Keyboard tasks | Full-board focus enters and stays in the dialog across repeated Tab, the background is inert, Escape returns to Full board; runs at 1280/390 in both themes. Cancelling simulation and dismissing the commissioner menu return focus. Calendar hour selection and rival roster expansion work with Enter. |
| Permissions / variants | Visitors cannot post a bid; offline conduct shows Record with no bidding form, nomination control or countdown. Snake rooms hide legacy money fields. Practice rooms with a populated roster expose no Drop or Trade, and Discard remains enabled during simulation. No league-focus write occurs. These are named fixture states, not every host/role/phase combination. |
| Layout | **56 audits PASS**, no page overflow, runtime errors or unexpected external requests. All named page states have 1280/390 coverage; auction and snake layouts also pass 320/1024 in both themes. Own-roster and expanded rival-roster action consumers are checked. Remote team-logo requests are intentionally blocked, so captures include missing-image fallbacks. Reduced motion enabled. |

Inspected current synthetic captures: [desktop auction](./reviews/draft-flow/auction-desktop-light.png), [phone lobby after saved availability](./reviews/draft-flow/lobby-phone-light.png), [phone full-board dialog with focus](./reviews/draft-flow/full-board-phone-dark.png), and [phone pick room with own/rival roster actions](./reviews/draft-flow/pick-rosters-phone-dark.png). Raw reports, before-failure evidence and logs stay in `outputs/draft-flow-review/`. The runtime resolves `.js` before `.jsx` to match the app's Windows behavior and never contacts the existing local app server.

Boundaries: no real league write, provider request, invite, production test or deploy ran. Browser sockets and bid responses are synthetic; this does not certify real network ordering, server concurrency, auction award animation, live timer accuracy, artwork delivery or field performance. Real authenticated routes, Sleeper variants, linear drafts and the mock-launch screen were not exercised. Contrast/assistive-technology/zoom and fresh Cursor rule-activation probes remain unverified. Next page-family work: Strategy, mock launch/recent mocks and Best ball, followed by the remaining accessibility and live-route evidence gaps.


## Follow-up: Strategy, mock launch and Best ball

Task: complete the next draft-preparation page family after merged #769. Baselines are Strategy's same-position face-offs and site/personal rankings, Mock's format/field/launch setup with recent rooms on the rail, and the existing Best ball ranking board. Attention order: player choice / rank consequence / personal queue; format and field / league match / launch; rank and player / ECR coverage and edge / filtered export.

Bounded pass: extend the existing isolated draft-fixture runtime and verify current components with synthetic data. Inspect league switches and queue scoping, independent context/recent-room loading, retained failed-launch choices, recent-room pin/resume actions, refresh-driven sort validity, missing ECR and full filtered exports from a windowed table. Preserve real-league focus, private queues, linked field size, frozen room data, honest missing values and the approved layouts. Findings and actual checks will be recorded after execution; no live account, league, provider or deployment action is part of verification.


Observed and fixed:

- Strategy skipped synchronizing a newly selected league when its personal queue had the same player IDs as the previous league. Scope hydration, local persistence and request deduplication by league plus board context; ignore the status of a completed request from an inactive scope. The controlled regression also holds a failed league-A request until league B has saved successfully, then verifies that A's error cannot replace B's status.
- A recent-mocks request failure discarded an independently successful league-context response, hiding the match-league setup controls. Preserve each successful result and show the failed request's error. Matching the synthetic ten-team league still locks the field to ten with nine bots after that history failure.
- Best ball retained an Edge selection after a refresh removed all ECR coverage and the Edge option. Derive one valid active sort for the menu, rows and position groups, falling back to Pos rank while retaining the user's preference if it becomes available again.
- Strategy's two player choices and its rankings browse action competed as filled primary buttons. Keep both peer choices equally styled at the secondary tier and preserve their full-width card actions; browsing is secondary too. The actual rankings view then exposed 32px phone queue-source controls. Its owning control primitive now uses the shared 32px desktop and 44px phone height tokens.
- The layout checker treated full-span empty/loading messages as data rows and reported fictitious numeric column packing on Best ball. Skip HTML tables with no individual body-column cells; real grouped/data-row misalignment and overwide-column regressions still fail. The shared browser regression now intercepts its unfinished background request instead of depending on a local HTTP connection, which stalled on this host.

| Follow-up gate | Result / actual scope |
|---|---|
| Frontend unit gate | **1,344 PASS**, zero failures: explicitly enumerated `.test.js` / `.test.mjs` plus layout-audit unit tests. Existing Windows Node 24 directory-argument limitation remains. |
| Targeted Python contracts | **77 PASS**, one dependency deprecation warning: mock draft, Best ball cache, product constitution and living surfaces. Isolated temp paths; backend source unchanged. Full backend ready gate not repeated for this draft. |
| Production frontend build | **PASS**; existing large-chunk warning remains. |
| Current browser tasks | `node scripts/dev/draft_tools_browser.mjs`: **42 scenarios PASS**. Production components with synthetic data and fully intercepted HTTP/WebSocket state. Four focused regressions reproduce queue-scope, late-error, independent-load and unavailable-sort boundaries. |
| Strategy tasks | Auction and snake face-offs compare the same position; keyboard choice and Undo restore the initial cards. Pick drafts show no auction prices. Personal queue failure retains the choice and retries successfully. Both rankings and face-off views run at 1280/390 in light/dark. |
| Mock tasks | Recent rail shows the latest three rooms. Matching league rules locks ten teams and requests nine bots. Failed launch retains the selected options; failed unpin retains the saved state and retries. The completed recent room opens its recap and returns to setup. Runs at 1280/390 in both themes. |
| Best ball tasks | A 120-player board windows its DOM rows but exports all 120. Quoted/comma player names round-trip. No-ECR filtering exports the exact 30 missing players; search further restricts export. Failed refresh retains the filtered saved data. Runs at 1280/390 in both themes. |
| Layout | **46 audits PASS**, no page overflow, runtime errors or unexpected external requests. All three pages pass 1280/390 in both themes and 320/1024 ready states in both themes. Initial empty/loading states run at 1280/390 light (Mock empty only). Reduced motion enabled. |
| Shared verification regressions | `layout_audit_browser.mjs` **PASS**: full-span empty/loading, grouped headers/totals, missing values, genuine alignment/packing failures and unfinished background request. `draft_room_browser.mjs --race-only`: **3 PASS**, preserving ordinary rejection and newer bid/phase behavior through the generalized fixture runtime. |

Inspected current synthetic captures: [Strategy desktop auction](./reviews/draft-tools/strategy-desktop-light.png), [Strategy phone snake](./reviews/draft-tools/strategy-phone-dark.png), [Strategy phone queue source](./reviews/draft-tools/strategy-rankings-phone-dark.png), [Mock desktop retained launch](./reviews/draft-tools/mock-desktop-dark.png), [Mock phone retained launch](./reviews/draft-tools/mock-phone-light.png), [Best ball desktop](./reviews/draft-tools/bestball-desktop-dark.png), and [Best ball phone](./reviews/draft-tools/bestball-phone-light.png). The phone Best ball table intentionally scrolls within its own container. Remote player/team artwork is blocked; those captures show missing-image fallbacks. Raw reports, captures, before-failure evidence and logs stay in `outputs/draft-tools-review/`.

Boundaries: no real account, league, provider, draft or focus write; no production test or deploy. This batch does not certify real authenticated routes, live network/server concurrency, account switching, linear drafts, successful launch/simulation, artwork delivery, field performance, or complete contrast/zoom/assistive-technology coverage. Other product pages were not rerun; the existing draft-room fixture received only its three rejection regressions. Next work should address the remaining live-route and accessibility evidence gaps, with fresh Cursor rule-activation probes still manual.


## Follow-up: navigation accessibility and deployed routes

Task: continue after merged #771/release #772 with navigation keyboard, contrast and reflow evidence. Preserve the approved flat desktop product/destination rows and compact phone header, destination sheets and bottom navigation. Attention order is current product/destination, reachable navigation choices, then account/secondary actions. Read-only browser inspection of deployed Weekly, Best ball and Fantasy succeeded; prior terminal TLS failures do not establish browser availability.

Observed friction: at a 390×360 CSS viewport on the deployed site, reverse Tab in More moves Account settings and Log out behind the sheet's sticky header. Forward focus stays trapped and Escape returns correctly. Bounded change: give the shared MobileBottomSheet scroll container clearance for its actual header height, including resized/wrapped titles, without changing approved composition. Add a reusable current-App fixture with intercepted account/league data, exercise route changes and all shared sheet consumers, inspect both themes/320px reflow and 200% text resizing, and measure named navigation text/focus contrast. Preserve existing focus containment, nested dialogs, rotation cleanup, selection, private queues and league focus; no real league/account writes or deployment.


Observed and fixed in this follow-up:

- Short-phone reverse Tab put More actions behind the sticky heading. The source fixture reproduced the deployed failure before the change. MobileBottomSheet measures its grip/header and any explicitly marked sticky footer, observes size changes and supplies native scroll padding. Contract history's Save/Cancel footer opts into that clearance; its previously covered text fields remain visible as focus moves in both directions. Phone contract text fields use the existing target-height token.
- Closing Notification settings after opening it from the desktop account menu returned focus to the body because its menu-item trigger had unmounted. Focus the persistent account trigger before opening the dialog. The isolated regression failed on the original code and passes after the fix; the same failure was observed on the deployed site. Phone More-to-settings return also passes.
- Projection Compare, preseason board filters and the filter-sheet team control could retain 32/36px desktop sizing on phone. Update their owning responsive rules to the shared target height, covering Weekly and both season modes. No new page layout or token.
- Classic dark filled buttons and Strategy's selected queue-source control used white text on blue. Reuse the existing foreground role with the canvas ink fallback, preserving light and Appearance palettes. The tested Classic action improves from **3.90:1 to 4.99:1**. Default/hover checks cover Classic, Cozy den, Snowfall, Autumn and Footballs in both modes.
- The layout audit counted a modal's inert background primary as actionable competition. Ignore inert descendants for this rule. Real-DOM regression checks retain the failure for two actionable primaries. Sheet entry animation now respects reduced motion.
- Added an overall acceptance checklist near the top of this record. The merged implementation/initial review and incomplete whole-project acceptance are explicitly distinct.

| Follow-up gate | Result / actual scope |
|---|---|
| Frontend unit gate | **1,344 PASS**; explicitly enumerated test files plus layout-audit unit tests. Final source-style subset: **12 PASS**. Existing Windows directory-argument limitation remains. |
| Targeted Python | **37 PASS**: living surfaces and product constitution, isolated temp paths. Backend source unchanged; full backend ready gate not repeated for this draft. |
| Production frontend build | **PASS**; existing large-chunk warning remains. |
| Current-App browser | `navigation_accessibility_browser.mjs`: **56 scenarios PASS**, **60 layout audits PASS**. Actual App/BrowserRouter with intercepted synthetic reads and rejected writes; direct production sheet consumers where appropriate. Weekly, preseason/live-season defaults, Fantasy Home and Best ball at 1280/1024/390 in both themes. |
| Sheet tasks | Forward/reverse Tab, visible focused targets, Escape/return, inert background, rotation cleanup, wrapped contract headers, nested menu-to-notification return, projection filters/player inspector, history editor and replacement confirmation. All seven MobileBottomSheet consumer types are exercised. Imports, contract saves and notification preferences are not submitted. |
| Reflow and contrast | More at 320/390×360 with normal and **200% root text size**, both themes; it scrolls without losing any menu action. This is text resizing, not a browser zoom test. **524 measured navigation/focus samples** pass their applicable thresholds, plus **20 palette/default-hover states**. The checker resolves computed colors/gradient stops for the named controls; it is not a whole-page contrast or WCAG assessment. |
| Route tasks | Four desktop/phone, light/dark journeys select Mock, visit Season, restore Mock through Tools, then return through browser Back and reload. Remembered destination and one main landmark persist; every fixture request remains GET/HEAD. Season fixtures provide matching preseason/live metadata; conflicting-default explicit-link retention remains an open route check. |
| Existing regressions | Layout-audit real DOM **PASS**, including inert-background and genuine competing-primary cases. Draft tools: **42 scenarios / 46 audits PASS**. Draft room: **3 rejection scenarios PASS**. These retain their earlier documented scopes. |
| Read-only deployed inspection | Weekly projections, Best ball and Fantasy Home loaded in the app browser. Account menu and phone destination containment/return worked; short More and desktop notification-return failures were reproduced. No forms, league switch, account change or deployment action was performed. Changed code is verified locally and has not been deployed by this task. |

Inspected synthetic captures: [desktop focus return](./reviews/navigation-accessibility/account-focus-desktop-dark.png), [320px doubled-text More](./reviews/navigation-accessibility/more-text-size-light.png), [phone projection filters](./reviews/navigation-accessibility/filters-phone-light.png), [phone player inspector](./reviews/navigation-accessibility/player-phone-dark.png), [phone contract editor](./reviews/navigation-accessibility/contracts-phone-dark.png), [laptop preseason board](./reviews/navigation-accessibility/preseason-laptop-light.png), [desktop Fantasy](./reviews/navigation-accessibility/fantasy-desktop-light.png) and [phone Fantasy More](./reviews/navigation-accessibility/fantasy-more-phone-dark.png). Artwork requests are blocked in fixtures. Reports, before-failure evidence and remaining captures stay in `outputs/navigation-accessibility/`.

Whole-project acceptance remains open: finish the remaining current-page visual/task evidence, relevant host/role and failure variants, broader contrast/zoom/assistive-technology checks and additional live journeys; perform the three fresh Cursor rule-activation probes. The single-player fixture also exposes existing singular-count copy on ranking boards for a later copy pass. Full backend merge gates and field-performance measurements are not claimed by this draft. The instruction system and 45-surface initial pass are implemented; this follow-up closes named verification gaps without certifying every page/state.


## Follow-up: Season link and ranking-count acceptance

Task: continue from merged #773 (`bc9cbbea`) with the outstanding explicit Season-link check and singular ranking-board labels. Preserve the approved compact Projections board and Best ball experience composition. Attention order: selected timeframe, matching forecast rows, then filters/counts.

The current metadata-default effect can replace a linked preseason/live mode; its manual-choice ref also resets when position metadata reloads. Reproduce both conflicting defaults using current App/BrowserRouter with intercepted reads before changing source. The previous one-player captures show “1 players” in Season metadata and Best ball status. Bound the change to route/default ownership and existing copy helpers. Keep plain Season automatic selection, explicit selections, remembered destinations, browser history, projection filters, missing values and export behavior; no account/league/provider writes. Verify delayed metadata, position refresh, mode changes, Back/Forward, area return and reload at 1280/390 in both themes, with layout audits and inspected captures. Whole-project acceptance remains open.


Observed and fixed:

- Both conflicting-default regressions failed before the source change: `/projections/season/preseason` became Live with in-season metadata, and `/projections/season/live` became Preseason with offseason metadata. Route parsing now preserves a missing mode as automatic; valid explicit modes remain authoritative. Plain Season resolves once from metadata with history replacement, so Back returns to the previous destination. Remove the redundant manual-choice ref that reset on position/product changes. Remember an unresolved automatic entry without turning it into an explicit Live choice.
- Preseason and Live season metadata reuse `BOARD_COPY.playerCount`; Best ball status pluralizes within its existing presentation module. Empty-board, loading, ECR coverage and multiple-player wording remain covered by the presentation tests.

| Gate | Result / actual scope |
|---|---|
| Focused frontend tests | **59 PASS**: routes, remembered destinations, navigation defaults and presentation helpers. |
| Full frontend unit gate | **1,345 PASS**; explicitly enumerated frontend test files and layout-audit unit tests. |
| Instruction/registry Python checks | **37 PASS**: living surfaces and product constitution, isolated temporary paths. |
| Production frontend build | **PASS**; existing chunk-size warning remains. |
| New current-App route acceptance | `season_route_browser.mjs`: **20 scenarios / 28 layout audits PASS**. 1280 and 390, light/dark: both explicit modes against delayed conflicting defaults, conflicting-default reload, position metadata refresh, clicked mode, Back/Forward, return through Tools, final reload and preserved season/week; plain Season defaults and Weekly-to-Season history; singular Best ball status. |
| Existing navigation regression | `navigation_accessibility_browser.mjs`: **56 scenarios / 60 layout audits PASS**, retaining its previously documented synthetic scope. |
| Writes / data | Current App and BrowserRouter with synthetic reads; every API write rejected, external artwork blocked. No real account/league/provider change or deployment. |

Inspected all twelve current synthetic captures at 1280/390 in both themes: [Preseason desktop light](./reviews/season-route-acceptance/explicit-preseason-1280-light-linked.png), [desktop dark](./reviews/season-route-acceptance/explicit-preseason-1280-dark-linked.png), [phone light](./reviews/season-route-acceptance/explicit-preseason-390-light-linked.png), [phone dark](./reviews/season-route-acceptance/explicit-preseason-390-dark-linked.png); [Live desktop light](./reviews/season-route-acceptance/explicit-live-1280-light-linked.png), [desktop dark](./reviews/season-route-acceptance/explicit-live-1280-dark-linked.png), [phone light](./reviews/season-route-acceptance/explicit-live-390-light-linked.png), [phone dark](./reviews/season-route-acceptance/explicit-live-390-dark-linked.png); [Best ball desktop light](./reviews/season-route-acceptance/bestball-count-1280-light-ready.png), [desktop dark](./reviews/season-route-acceptance/bestball-count-1280-dark-ready.png), [phone light](./reviews/season-route-acceptance/bestball-count-390-light-ready.png), [phone dark](./reviews/season-route-acceptance/bestball-count-390-dark-ready.png). Both Season metadata and Best ball status now say “1 player.” The Live fixture intentionally lacks recorded/game-count data, which stays missing/Untiered. Best ball's phone table retains its approved horizontal container. Raw reports, before failures and logs remain under ignored `outputs/`.

This closes the named conflicting-default route and singular-count findings. Whole-project acceptance remains open for broader current page/state, host/role, live-route and accessibility evidence and the three fresh Cursor activation probes. No production, field-performance or full backend merge gate is claimed.


## Follow-up: Rules save state and setup roles

Task: continue from merged #775 (`ea9e25c1`) with current Rules/setup acceptance. Preserve September 16 guided categories, the one persistent Save/Discard surface, saved-versus-preview summary and existing connection disclosures. Attention order: selected league/host, editable versus commissioner-managed rules, then the exact pending/unsaved consequence.

Source inspection identifies unguarded Rules save completion: it always reapplies submitted server state and invokes its captured parent callback, even if the user has edited again or the bound source changed. Reproduce delayed success/error and source changes before fixing. Bound changes to retaining post-submit edits, acknowledging only the submitted baseline and ignoring obsolete completions. Preserve form league ownership, failed input, server normalization, templates/scoring ownership, unsaved navigation and native/Sleeper and salary/pick restrictions. Use current production components with synthetic request queues only. Review Rules/setup role/host variants and pending/error/preview states at 1280/390 in both themes, add 320 for fixed-save reflow, audit and inspect captures. No real save, link, sync, import, invitation or league-focus write.


Observed and fixed:

- Before the fix, a successful delayed save replaced “Newer unsaved A” with the submitted/normalized name. Preserve the current form when it differs from the submitted snapshot, acknowledge the server-normalized submitted baseline only, and explain that newer edits still need Save. Discard returns to that acknowledged baseline. Category changes and failed saves retain input.
- A save started in A could overwrite B's form, show an obsolete error, or invoke A's captured parent callback. Invalidate pending completions when the source changes or the editor unmounts. A → B → A is a new visit; an old completion cannot affect it. A's completion cannot unlock B's pending save. Save requests retain the form's explicit `league_id`. Ignore obsolete template confirmations too.
- Phone save outcomes lived in the summary below the visible form. Put outcomes and validation guidance beside the existing Save/Discard actions, with the existing opaque surface token. Clear stale outcome text on Discard and source change. The explanation wraps before the desktop action labels; Save no longer breaks across three lines.

| Gate | Result / actual scope |
|---|---|
| Focused frontend | **19 PASS**: Rules presentation and unsaved navigation. |
| Full frontend unit gate | **1,346 PASS**; enumerated frontend tests plus layout-audit unit tests. |
| Instruction/registry Python | **37 PASS**; isolated temporary paths. |
| Production frontend build | **PASS**; existing chunk-size warning remains. |
| Production-component browser | `rules_state_browser.mjs`: **66 scenarios / 120 layout audits PASS**. Rules and setup at 1280/390 in both themes; validation/pending/error/retry/success also at 320. Uses current components inside a synthetic BrowserRouter scaffold, not the full App header/chat shell. |
| Save tasks | Post-submit edits, normalized acknowledgement/Discard, delayed success/error after source change, overlapping saves in different sources, A → B → A, unmount completion, invalid-name rejection, category retention and retry. Phone outcome text is tested visible and unobscured within the scaffold viewport. |
| Access / host tasks | Four representative variants: native salary-cap commissioner/member; Sleeper snake commissioner; Sleeper linear member. Members have disabled rule fields and no Save or Manager names. Linked scoring opens Sleeper and offers no native scoring editor. Pick rules hide salary categories/cap input and monetary summary. This is not every host/format/role combination. |
| Templates / setup | Template cancel/confirm/Undo preserves scoring and makes no save; obsolete confirmation is ignored. Leave/Keep editing confirmation traps focus and retains edits on cancel. Setup opens connections and navigates to Rules with the same role. Draft-night controls are read-only; imports remain staff-gated. No link, sync, import, invitation, focus or other API write is allowed. |

Inspected synthetic evidence includes [phone failed save, light](./reviews/rules-state-acceptance/failed-save-390-light-error.png), [dark](./reviews/rules-state-acceptance/failed-save-390-dark-error.png), [320px failure](./reviews/rules-state-acceptance/failed-save-320-dark-error.png), [desktop validation](./reviews/rules-state-acceptance/failed-save-1280-light-invalid.png); retained newer edits [desktop dark](./reviews/rules-state-acceptance/newer-edit-1280-dark-newer-edits.png), [desktop light](./reviews/rules-state-acceptance/newer-edit-1280-light-newer-edits.png), [phone light](./reviews/rules-state-acceptance/newer-edit-390-light-newer-edits.png); setup [native commissioner desktop](./reviews/rules-state-acceptance/setup-commissioner-auction-native-1280-light-ready.png), [native member phone](./reviews/rules-state-acceptance/setup-member-auction-native-390-light-ready.png), [linked commissioner desktop](./reviews/rules-state-acceptance/setup-commissioner-snake-sleeper-1280-dark-connection.png), [linked member phone](./reviews/rules-state-acceptance/setup-member-linear-sleeper-390-dark-connection.png); Rules [native member desktop](./reviews/rules-state-acceptance/rules-member-auction-native-1280-dark-scoring.png), [native member phone](./reviews/rules-state-acceptance/rules-member-auction-native-390-dark-scoring.png), [linked pick member](./reviews/rules-state-acceptance/rules-member-linear-sleeper-390-light-format.png), and [linked commissioner](./reviews/rules-state-acceptance/rules-commissioner-snake-sleeper-1280-light-scoring.png). The captures show named visible portions/states only; every remaining image is not claimed individually inspected. Before failures, reports and logs remain in ignored `outputs/rules-state-acceptance/` and `outputs/rules-state-*.log`.

Only queued synthetic Rules PUTs are exercised. Real API validation/transactions, the full App's parent refresh/league-switch journey, Manager names writes, successful imports/connections and live authenticated roles remain unverified by this batch. Other pages were not rerun. The remaining whole-project checklist and three fresh Cursor activation probes stay open; no deployment, full backend merge gate, WCAG conformance or field-performance measurement is claimed. Next acceptance work should cover Cap/Rosters/My team context and permission journeys against current source.


## Follow-up: Cap, Rosters and My team context acceptance

Task: verify current league/team context, owner/staff/read-only permissions, salary versus pick behavior and preview safety. Preserve approved Cap B sheet/calculator, Rosters table/directory/details and My team Room/Lineup/Manage roster. Attention order: whose team is displayed, saved versus preview consequence, then the permitted action.

Cap and Rosters already key browsing state by context. Inspect My team's state and pending action closures, especially confirmation/completion across context changes. Reproduce findings with synthetic data before editing. Bound changes to demonstrated context/permission failures; reuse roster/cap helpers and server eligibility/math. Cover other-team previews, scoped browsing preferences, stale reads, retained failures, dialogs and room swaps at 1280/390 in both themes, with additional narrow/laptop checks where needed. Block unrelated writes, use queued fixture roster/extension responses only, and record machine, visual and task evidence separately. No real cut, extension, trade, lineup, focus or account change.


Observed and fixed:

- Cap and My team could send a cut after confirmation opened on league A and the displayed context changed to B. The pre-change browser checks reproduce both writes. A shared action-scope capture now invalidates confirmations on league/team/season changes, permission changes and unmount, including A → B → A. Late cut/undo/extension replies cannot update messages, refresh callbacks or navigate the newly displayed context. My team staff removal uses the same guard.
- My team exposed Cut and Team appearance in a read-only league context. Its contract/extension/removal/appearance actions now honor the current write context. The legacy `readOnly` salary-editor prop still allows a league owner to use permitted owner actions; staff-only removal remains separate. Backend ownership and eligibility remain authoritative.
- My team's local dialogs, edits and filters now remount with league/team/season/cache context, preventing an old player's detail state from carrying into another team. Permission-transition checks also caught a stuck busy state after revocation/restoration; both surfaces clear invalidated action messages and busy state while ignoring the old completion.
- Staff removal testing exposed a nested-modal cleanup failure: unmounting the old contract panel beneath a still-open confirmation could leave the new page inert and scroll locked after dismissal. The shared modal background lock now preserves one original page state until the last modal closes, regardless of close order. Only the top modal owns keyboard input and focus restoration. Six focused unit cases cover ordinary/nested/out-of-order cleanup, existing inert state, idempotent release and independent documents; staff browser checks reproduce the actual league-switch sequence.

Existing approved presentation, contract helpers and server cap math are reused. Rosters needed no product code change: exercised refresh retention, per-league browsing state and stale-read protection already behave correctly. No CSS, navigation, domain policy or API contract changes. The shared modal hook changes background/focus cleanup only; it introduces no new visual primitive.

Machine evidence: `node scripts/dev/roster_context_browser.mjs` runs the current production components with fully intercepted synthetic HTTP data in Edge. The component scaffold includes production styles and identity providers; it does not render the full App header, league strip, chat or authentication journey. All 144 scenarios and 168 embedded layout measurements pass, with no horizontal page overflow, page errors or unexpected requests/writes. The same `layout_audit.mjs` measurement engine is used; this is component-fixture geometry evidence rather than a full-shell live-route audit.

| Affected surface | 1280 light/dark | 390 light/dark | Additional geometry |
|---|---|---|---|
| Cap (`hub.planner`) | PASS | PASS | 320 and 1024, both themes: PASS |
| Rosters (`hub.rosters`) | PASS | PASS | Explicit selection, stale/failed reads and pick variants |
| My team (`hub.roster`) | PASS | PASS | Read-only, staff, pick, native/Sleeper room variants |

Task evidence:

- League/team/round-trip confirmation changes send no stale write. Late success/error replies after a context switch do not call the current refresh/navigation callbacks. Read-only revocation suppresses writes, and restoration does not retain an invalidated busy/error state.
- Owner cut failures retain the selection and allow a retry; only the successful current-context synthetic reply triggers refresh. Pre-draft owner extension uses the existing POST endpoint and selected years; a late reply cannot refresh the next league. Staff removal is available in salary and pick fixtures, ignores stale confirmation/completion and refreshes only the current context.
- Cap retains separate own/other-team plans, restores the own preview, resets it explicitly and offers no roster writer for another team. The sample current year has $144 salary + $8 dead cap + $48 remaining = $200; another-team preview has $108 remaining. These are existing sample server cap sheets, not newly calculated backend results.
- Rosters begins without implicit player selection, keeps all six active players in Team rosters when an estimate is missing, shows unknown values as dashes, retains the last good rows through a failed refresh, restores search only within its league and discards out-of-order A data after B loads. Escape returns focus to the selected player trigger. Snake/linear variants omit financial concepts on all three surfaces.
- Native/Sleeper Room swaps change the synthetic projection preview from 35 to 50 without a lineup write; Reset restores 35. A visitor cannot preview or share another room. Missing forecasts remain unknown, and a locked bench player cannot enter a preview slot. This covers Room previews, not the separate editable Lineup tab.

Visual evidence: inspected the named captures below, including phone controls below the fold. They preserve the approved sheet/calculator, directory/details and room/contract-panel composition in the displayed states. The screenshots show only their captured portions. External player artwork is blocked in this isolated fixture, so artwork delivery is not verified. Other captures are not claimed individually inspected.

- Cap: [desktop dark preview](./reviews/roster-context-acceptance/cap-planning-1280-dark-own-preview.png), [laptop light preview](./reviews/roster-context-acceptance/cap-planning-1024-light-own-preview.png), [phone other-team preview](./reviews/roster-context-acceptance/cap-planning-390-light-other-preview.png), [phone preview controls](./reviews/roster-context-acceptance/cap-planning-390-light-other-preview-lower.png), [320px controls](./reviews/roster-context-acceptance/cap-planning-320-dark-other-preview-lower.png), [phone failed-cut controls](./reviews/roster-context-acceptance/cap-failed-cut-390-light-retained-lower.png).
- Rosters: [desktop missing estimate](./reviews/roster-context-acceptance/rosters-browsing-1280-light-missing-estimate.png), [phone retained refresh failure](./reviews/roster-context-acceptance/rosters-browsing-390-dark-refresh-error.png), [phone selected detail](./reviews/roster-context-acceptance/rosters-browsing-390-light-missing-estimate-lower.png), [pick roster details](./reviews/roster-context-acceptance/rosters-snake-1280-dark-details.png).
- My team: [read-only desktop](./reviews/roster-context-acceptance/team-readonly-1280-light-details.png), [read-only phone](./reviews/roster-context-acceptance/team-readonly-390-dark-details.png), [failed-cut desktop](./reviews/roster-context-acceptance/team-failed-cut-1280-dark-retained.png), [pick phone details](./reviews/roster-context-acceptance/team-linear-390-light-details.png), [native desktop preview](./reviews/roster-context-acceptance/room-native-1280-dark-preview.png), [Sleeper phone preview](./reviews/roster-context-acceptance/room-sleeper-390-light-preview.png), [staff salary confirmation](./reviews/roster-context-acceptance/team-staff-auction-1280-dark-confirmation.png), [staff pick phone confirmation](./reviews/roster-context-acceptance/team-staff-snake-390-light-confirmation.png).

Full frontend tests: 1,352 PASS using an explicit `*.test.js`/`*.test.mjs` file list plus `scripts/dev/layout_audit.test.mjs` (this Windows Node runtime does not accept the package script's directory discovery). Production build: PASS, existing chunk-size advisory. The unchanged navigation/accessibility runner also passes all 56 synthetic cases after the shared modal fix: short/doubled-text More sheets, 1280/1024/390 navigation, player inspector keyboard/focus, sheet consumers and route return journeys; no writes. This regression run is machine/task evidence, not a new visual review of every shared-modal consumer. Affected Python checks: 54 PASS across `test_cap_planner.py`, `test_roster_ownership_isolation.py`, `test_living_surfaces.py` and `test_product_constitution.py`; one existing Starlette/AnyIO deprecation warning. Before-failure logs, full reports and remaining captures stay in ignored `outputs/roster-context-*` and `outputs/roster-readonly-extra-before.log`.

Boundary: roster/extension/remove replies are queued synthetic responses; they do not persist a roster change or recompute cap sheets. Real transactions, full App parent refresh/league-switch ownership, live authenticated roles, appearance saves, solo salary editing and editable Lineup journeys remain unverified by this batch. No real roster, lineup, focus, trade or account change was made. Other product journeys were not rerun beyond the named shared navigation regression. The whole-project checklist, three fresh Cursor activation probes, live-route and remaining accessibility evidence stay open; no full backend ready/merge gate, deployment, WCAG certification or field-performance measurement is claimed. Next acceptance work should cover Roster management and acquisition/waiver permissions, retained input and context changes.
