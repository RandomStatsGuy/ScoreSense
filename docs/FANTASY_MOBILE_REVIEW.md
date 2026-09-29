# Fantasy mobile review

September 28, 2026 · source review and first design previews

## Status

Reviewed the Fantasy destination registry, page structures, shared phone styles, and mobile components. Findings below are based on the current working tree, which includes existing uncommitted work. This is a source audit, not a completed browser walkthrough of the live product. Home A is now implemented in the product; the remaining pages are still a source review.

First reviewable page: **Home**, with [A/B previews](mockups/fantasy-mobile-home.html). Both include in-season and pre-draft sample states. Preview figures are illustrative, not league results. Both lead with the matchup in-season: A keeps it compact; B features a larger scoreboard. The next-action section appears only pre-draft, per the September 29 correction. The repository's fast-ui-mock workflow requires a chosen option before implementation.

The approved Home direction now seeds the [mobile rules](../.cursor/rules/fantasy-mobile.mdc), shared `mobile-foundation.css`, and `_mobile-starter.html`. `scripts/dev/mobile_mock.py` parameterizes destination/league names and fingerprints preview assets. Home A/B both consume the shared foundation; Home phase and matchup logic remain separate.

## Mobile standard for this pass

- Show the page's main decision in the first phone screen.
- Use at most one meaningful primary action. Secondary actions use quiet buttons or links.
- Name the destination once; avoid repeating the page title, eyebrow, and instructional headline.
- Keep one short support line only where it changes the decision.
- Put extra statistics, rule explanations, history, and advanced inputs behind a deliberate tap.
- Use compact player rows: identity, the decision value, and one immediate action. Expand details on demand.
- Keep essential context visible: projection scale, transaction restrictions, cap consequences, scoring ownership, and unsaved state.
- Use 44px touch targets, 12px minimum text, readable input text, keyboard focus, and safe-area spacing.
- Let the page scroll. Keep fixed navigation, chat, and page actions from covering each other.
- Preserve the approved team-room, matchup, strategy, and rosters identities.

## Shared findings

| Finding | Evidence | Next change |
|---|---|---|
| Desktop rails become another full section on phone. | `product-hierarchy.css` changes experience layouts to one column at 860px; summary becomes static. Phone summary facts also stack label above value. | Establish a compact phone summary mode. Show only the fact needed for the current action; disclose the rest. Check each consumer before applying. |
| Large introductory blocks cost the first screen. | Shared phone hero retains padded heading/support/chip structure. Home priority has a 15rem minimum height and 2rem heading. | Reduce mobile introduction height through shared primitives; let useful content start earlier. Keep meaningful status. |
| Home's phase indicator is explicitly hidden on phone. | `fantasy.css`: `.hub-league-home--mobile .hub-home-phase-track { display: none; }`. | Restore a compact phase indicator in the chosen Home design, matching its living-surface rule. |
| Player detail cards can turn into stat dashboards. | Free agents' `ValueSheetTable.jsx` expanded mobile grid includes season points, range, risk, adjusted delta, advanced spread/per-game/min/max, cost delta, and status. | Keep identity, suggested bid or season points, and Add/Bid in the row. Group advanced information inside details. |
| Loading is inconsistent. | `DraftHub.jsx` has text Suspense fallbacks; `ContractPlayerJourney.jsx` and `DraftAvailability.jsx` also render loading sentences. | Replace relevant fallbacks with shared skeleton dimensions; announce loading accessibly. |
| Phone spacing has accumulated literal values and exceptions. | `fantasy-phone.css` contains per-surface padding and multiple fixed-action offsets. | Consolidate safe-area/action spacing and token insets as each affected primitive is revised. Do not apply a blanket density reduction. |

## Page-by-page queue

Priority reflects mobile utility and visible source complexity, not measured usage analytics. Proposed changes need a design preview and live-state verification before shipping.

| Order | Page / living surface | Current structure or friction | Proposed mobile pass |
|---|---|---|---|
| 1 | Home · `hub.home` | Priority action, separate multi-fact snapshot, matchup, standings, Also due, and chat become a vertical stack. Chat repeats an eyebrow, heading, and explanatory note. | In-season matchup with records beside manager identities; no next-action section or draft-leftover context. Keep the next-action deck pre-draft; chat then standings, with Needs attention last and only for actionable unresolved issues. Keep league chat on Home. A/B preview ready. |
| 2 | This Week · `hub.week` | Hero, call jump link, decision summary, starter slate, and bench share the screen. The rail inserts a section between starters and bench on small screens. | Put week/call count and starter slate first. Preserve aligned projection values and visible Start/Find actions. Keep bench easy to reach and the existing Ticket comparison side by side. |
| 3 | My team · `hub.roster` | The room and contract-management surface serve different tasks. Contract sheets already support phone details. | Preserve the immersive room. Make Room/Manage roster clear; compact identity/cap line, concise contract rows, full terms/actions in the existing sheet. Keep owner Cut and staff Drop distinct. |
| 4 | Free agents · `hub.available` | Expandable cards support many stats and several row actions. Acquisition context, board filters, and player information can compete. | Search plus position/filter control; compact player/bid rows. Keep Add/Bid visible even when disabled. One restriction message, advanced stats/history behind details. |
| 5 | Game center · `hub.game` | Approved split scoreboard, jersey duel, full starters, and league/details views already exist; it needs a scoped density pass. | Keep the personalized scoreboard and your matchup. Trim repeated labels; keep starter comparison readable, with Bench/League clearly separated. Distinguish projections from actual scores. |
| 6 | Cap · `hub.planner` | Hero, summary, move inputs, open pending-cut/extension lists, expiring contracts, and multi-season sheet add substantial length. | Put selected move and resulting leftover together. Collapse secondary lists; show useful seasons only. Keep current leftover, salary/dead-cap meaning, and cut consequences explicit. |
| 7 | Trades · `hub.trades` | Builder, partner selection, package, current cap, week preview, inbox, and ideas create a complex workflow. | One step per view: partner → players → review. Compact Send/Get rows; persistent package result and one Continue/Propose. Put explanation and alternatives behind disclosure. |
| 8 | Draft lobby · `hub.room` | Calendar, alternate date form, room/keepers, invites, setup, and offline options need state-aware ordering. | Calendar or locked night leads. Invite/room state follows. Collapse setup and alternate/offline paths; preserve the off-calendar primary when scheduling is closed. |
| 9 | Live draft · `hub.room.live` | Command bar, nominee, bidding, player pool, queue, team rosters, and integrated chat share a demanding live surface. | Keep nominee, clock, high bid, leftover, and bid control reachable. Secondary pool/queue/team/chat access should not shift bidding controls. Verify real timer and paused/empty states separately. |
| 10 | Rosters · `hub.rosters` | Approved compact comparison table, many filters, pagination, and inline phone detail already exist. | Keep approved table-first layout. Simplify the phone filter footprint; retain adjacent salary/estimate/difference and one selected-player action area. |
| 11 | Strategy · `hub.value` | Pairwise photos/cards, scoring context, filters, Undo, rankings, Skip/Too close, progress and keyboard hint. | Keep both same-position choices legible without long scrolling. Short context, touch-oriented hints, and quiet rankings/undo controls. Preserve the board-first exception. |
| 12 | Vibes · `hub.vibes` | Hero, card, progress/hint, voting, today's ratings, slate, and research comparison can stack. | Rate one player first; one progress line and comfortable equal vote buttons. Show rankings/research on demand. Keep research clearly distinct from This Week calls. |
| 13 | Rules · `hub.rules` | Many policy inputs, description lines, scoring fields, full summary, templates, and sticky Save. | Short section summaries with details on demand. Preserve open Draft behavior, separate vet toggles, field labels, and the new-contract-only note near Save. Keep preview/unsaved state visible. |
| 14 | Insights · `hub.insights` | Plaque, years, records, scoring boards and history tabs have an approved visual hierarchy. | Compact phone overview and year selection; show a few meaningful rows with full lists accessible. Keep owner identity and field-scaled rank bars. |
| 15 | Contracts · `hub.office.current` | Team disclosures, phone edit fields/schedules, source information, owner changes, pending tray, and lifecycle actions. | Select one manager, inspect one player; use a focused edit sheet. Keep pre-draft Save/Discard and after-draft immediate-write behavior explicit. Separate destructive actions. |
| 16 | Salary sheets · `hub.office.historic` | Multi-season league totals and team tables, editable cells, missing-player reconciliation, and source markers. | One season and manager at a time, compact totals, details for other seasons and reconciliation. Avoid shrinking spreadsheet text to fit. |
| 17 | Corrections · `hub.office.corrections` | Each player exposes ID/name/position/slot inputs; preview uses a wide before/after results table. | Week/team selection first; focused player edits, mobile before/after rows, then reason and preview. Preserve blockers and audited publication; no implicit historical ownership. |
| 18 | Members · `hub.office.members` | Capacity, teams, claimed managers, resizing, adding/removing teams and role actions need distinct meanings. | One capacity summary, compact manager rows, secondary role/seat actions. Retain explicit removal consequences. |
| 19 | Access & imports · `hub.office.access` | Seat-email assignment, links, imports, workbook export, and league deletion are different tasks. | Group connections and imports as disclosures. Separate league deletion from everyday controls; preserve import preview and confirmations. |
| 20 | Setup · `hub.setup` | Connection/create/join/import panels already have a mobile accordion path. | Lead with the relevant create/join/connect action. Collapse linked connections and historical imports; draft scheduling stays on Draft. |

## Matchup rollover check

Home currently requests `/live-scoring` without a week override; `resolve_current_week()` follows Sleeper's NFL state. There is no explicit Wednesday Home rollover. The shared projection-board helper instead rolls on Tuesday 00:00 Eastern, so it does not establish the requested Home behavior. September 29 requirement: starting Wednesday 00:00 Eastern, Home uses the approaching week's opponent and projections, labeled as projected points. Before then it retains the previous matchup result. Eastern matches the repository's NFL/waiver calendar conventions. This is recorded for Home implementation; the static preview does not implement live date selection. Verify Tuesday/Wednesday boundaries, same-week opponent/projection data, missing projections, linked and native leagues, and delayed games without relabeling last week's figures.

## First-page design options

- **A — compact matchup:** the in-season matchup leads, with records beside each manager and no draft-leftover row. Next action appears only pre-draft.
- **B — featured matchup:** a larger in-season scoreboard leads, with records beside each manager. Draft context appears only pre-draft. Next action appears only pre-draft.

Both use sample data, short labels, native disclosures, a compact phase track, and safe-area bottom navigation. September 29 revision centers matchup headings and key facts; Home and the quieter league switcher now share one compact phone toolbar with More, replacing the two centered header pills; preserves left alignment for messages and lists; adds section icons and large plus/minus disclosure controls. Chat and standings precede the conditional Needs attention section. The ordinary in-season example omits that section; the pre-draft example shows two unresolved contract decisions. Pre-draft removes matchup/standings and shows seats and draft-night status. Destination buttons in these static previews only announce their target; they do not implement product navigation or write league data.

## Verification and rollout

Preview screenshots and machine audit: `docs/mockups/fantasy-mobile-review/`. The static preview script checks 390/1280 layouts, phase switching, secondary disclosures, preview navigation, 44px control heights, horizontal overflow, and script errors.

| Static Home preview | 390px | 1280px |
|---|---|---|
| A · Compact matchup | PASS | PASS |
| B · Featured matchup | PASS | PASS |

Screenshots inspected at both widths. Interaction checks passed for both options, including keyboard chat collapse/expand, standings disclosure, conditional issue visibility, ordering below league activity, and a single phone header no taller than 72px. Preview scenario controls sit outside the app chrome. The automated layout audit does not validate real product data, focus trapping, transactions, or every offscreen control; these remain implementation checks.

After a design pick, implement Home in the existing page/copy and shared primitives. Verify the actual app at 390 and 1280, including real league data, long names, no roster, loading, errors, readonly permissions, and pre-draft/in-season states. Then proceed through the queue with one reviewable page at a time. Shared component changes require checks on every consumer. The remaining product pages have not been browser-tested in this pass.

### Reusable foundation verification · September 29

Home A and B still pass layout and interaction checks at 390/1280 after sharing styles and preview controls. The generated starter also passes at 320/390/1280 with long destination and league names, accessible pickers, and native keyboard disclosures. Screenshots were inspected at 390 (Home) and 320 (starter); the existing in-app Home tab was reloaded and shows the versioned foundation, 61px header, 20px icons, and no horizontal overflow. Reports: `mockups/fantasy-mobile-review/audit.json` and `foundation-audit.json`. Four asset-version regression tests and 41 existing layout/registry tests pass. Skill validation passes. Home A and the Wednesday week switch are implemented. See the release verification below.


### Home implementation · September 29

Home A uses production header, disclosures, chat, and identity components. Desktop league selection stays left. Chat drafts survive collapse/reopen. Wednesday 00:00 Eastern selects one upcoming week for opponent and projections; missing schedule/projections stay unavailable.

Deterministic production-component fixtures pass layout and interaction checks at 390/1280 in season, pre-draft, non-salary, empty, error, loading, missing projection, actionable issue, and staff states. 320px long names and league menus pass. Checks include keyboard disclosures, preserved chat drafts, mock message send, league switching, destination picker, More, and Game center week navigation. No real chat messages are sent. The fixture is not a production-data walkthrough. Targeted Python checks: 81 passed.

Release integration preserves the production revision `77dffb8`, including the unified This Week navigation. Its Home link reads Open This Week. Final targeted JS checks: 56 passed; integrated targeted Python checks: 69 passed; build passed. Broader JS suite: 895/900, with five existing failures in unchanged contract/copy/page-title expectations. Local Home, Cap, My team and Rules were opened at 390/1280. Home geometry and menus pass; the signed-out development shell triggers the global two-primary audit on desktop (Sign in plus the page action). Existing chat-dismiss touch targets fail on My team/Rules at 390; that untouched dock is queued for its own mobile pass. Production authenticated in-season data is covered by fixtures, not a live account walkthrough.
