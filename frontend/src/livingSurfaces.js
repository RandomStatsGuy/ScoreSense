/**
 * Living surfaces — the shipped files an agent must open and match.
 * Not imported by the app. Agents and tests only.
 *
 * Resolve from a prompt, a nav id, or a file path. Do not invent chrome.
 */

export const CHROME = Object.freeze([
  "experience",
  "action-center",
  "rules-center",
  "table",
  "board",
  "matchup",
  "draft-live",
  "office",
  "account",
]);

export const SHARED = Object.freeze({
  tokens: [
    "frontend/src/styles/tokens.css",
    "frontend/src/styles/product-hierarchy.css",
    "frontend/src/styles/product-rhythm.css",
    "frontend/src/styles/fantasy-phone.css",
  ],
  primitives: "frontend/src/DraftHub/HubUILayout.jsx",
  // Request painted size via HubMediaImg / identityMediaUrl (?w=48|96|256).
  media: "frontend/src/DraftHub/HubMediaImg.jsx",
  ownerLabel: "frontend/src/DraftHub/hubTeamLabel.js",
  chat: [
    "frontend/src/DraftHub/FantasyChatDock.jsx",
    "frontend/src/DraftHub/fantasyChatPresentation.js",
  ],
  mobile: [
    "frontend/src/layout/MobileShell.jsx",
    "frontend/src/layout/MobileHeader.jsx",
    "frontend/src/layout/MobileDestinationSheet.jsx",
    "frontend/src/layout/mobileChromePresentation.js",
    "frontend/src/DraftHub/leagueAttention.js",
    "frontend/src/DraftHub/LeagueOverflowLead.jsx",
  ],
});

const S = (row) => Object.freeze(row);

export const LIVING_SURFACES = Object.freeze({
  "hub.home": S({
    label: "Home",
    chrome: "action-center",
    route: "/hub/home",
    page: "frontend/src/DraftHub/LeagueHome.jsx",
    copy: "frontend/src/DraftHub/leagueHomePresentation.js",
    doNot: "Do not wrap Home in HubExperienceLayout. The page hero is eyebrow + a centered phase stepper — the heading stays in the Pre-draft card. Settings sits in the hero chip slot (top-right), never under the stepper. Also due uses the same extend/expiring nouns as My team and Cap (2 to extend · 5 expiring). Extend the action deck. The deck action is the only page primary. Chat Send is ghost. House the league thread in the locker rail. Do not show the edge launcher on Home. Do not add a Chat destination. Draft night · Not scheduled links to Draft. Clear chat is staff-only, red, confirms, and disables when the thread is empty. Home names the roster hole over a commissioner invite. Hide Your matchup / Standings when pre-draft with no scored week. Gate the hero on load — never Fill the seats over unresolved data. After 3s of loading, the action deck names the Sleeper sync. Also due does not style a count like a link. The shared league strip (and Needs attention) shows on Home. Strip Switch league / Sync league menus must paint above the Home page card below the strip — raise the bar, do not treat Needs attention as the cover. On phone, a one-row league strip (name + caret) sits under the picker — do not restack a second league card in the overflow.",
  }),
  "hub.value": S({
    label: "Strategy",
    chrome: "board",
    route: "/hub/strategy",
    page: "frontend/src/DraftHub/StrategyBoard.jsx",
    copy: "frontend/src/DraftHub/strategyRankPresentation.js",
    also: [
      "frontend/src/DraftHub/strategyRank.js",
      "frontend/src/styles/strategy-board.css",
    ],
    doNot: "Do not add HubExperienceHero. Strategy is the only Fantasy destination without a hero band — a deliberate board-first exception. Face-off is the Strategy page (full-page cards). Cards show a larger player photo on a faded team backdrop. Pairs are the same position only. View my rankings opens site vs mine. Not a leftover-cap spreadsheet and not a Vibes clone. Never show Hub in the scoring label. Suggested bid names scoring and Rules risk posture.",
  }),
  "hub.available": S({
    label: "Free agents",
    chrome: "table",
    route: "/hub/free-agents",
    page: "frontend/src/DraftHub/ValueSheetTable.jsx",
    copy: "frontend/src/DraftHub/acquisitionWindow.js",
    doNot: "Do not add a second pickup board. Players-tab adds follow the calendar. Suggested bid names scoring and Rules risk posture. Never show Hub in user copy. Rows always show Bid or Add; when locked, disable with Adds open after the draft — do not omit the action. Star is Star for draft with a visible starred state. Hide Vs cost until a contract cost exists. Fold tier into the player cell. Desktop virtualizes on page scroll — no nested table scroller. Season pts use a number plus text range. How adds work lives in the acquisition banner. Mobile still shows the disabled Add beside the muted SUGGESTED bid.",
  }),
  "hub.room": S({
    label: "Draft",
    chrome: "experience",
    route: "/hub/draft",
    page: "frontend/src/DraftHub/DraftLobby.jsx",
    copy: "frontend/src/DraftHub/draftAvailabilityPresentation.js",
    also: [
      "frontend/src/DraftHub/DraftEntryPanel.jsx",
      "frontend/src/DraftHub/DraftAvailability.jsx",
      "frontend/src/DraftHub/DraftNightSchedule.jsx",
      "frontend/src/DraftHub/DraftSeat.jsx",
      "frontend/src/DraftHub/draftSeat.js",
      "frontend/src/DraftHub/leagueAccessCopy.js",
    ],
    doNot: "Idle Draft uses experience chrome and one featured job: the shared calendar. Live rooms do not. The shared league strip shows on idle Draft and hides once the room is live. Calendar shows current and future times only. Lock draft night from any shown overlap, or the tapped hour even when no overlap exists yet. Once locked, the hero is Draft night is locked. Fill the room. When the room is also full, switch to Room is full. Draft night is locked. and put Start live draft on the hero. The calendar collapses to a one-line disclosure. Do not repeat Night locked as a green body heading — keep the card-header chip and the rail Locked night. Keep the date/time form, invite essays, and a second seat list collapsed unless the calendar is Closed and no night is locked — then the off-calendar lock is open as the card primary and Mark yours is gone. Off-calendar lock lives inside the When-can-you-draft card. Keepers sit inside The room card. Times saved is the teal saved chip, not a disabled primary. Start live draft stays secondary until a night is locked or the room is full. Seating pill counts claimed teams and is amber below a full room, teal only at 12/12. Locked night shows in the viewer timezone; Draft setup names league time once. Room seat tiles keep token padding and product type — do not pack Take flush to the chip. Use DraftSeat so Mock and the live room inherit Open · Take / YOU. On phone, calendar sits above Draft setup; invite/copy live under Share the room; one status chip replaces Locked in / Times saved.",
  }),
  "hub.room.live": S({
    label: "Draft (live)",
    chrome: "draft-live",
    route: "/hub/draft",
    overlay: true,
    page: "frontend/src/DraftHub/DraftRoom.jsx",
    copy: "frontend/src/DraftHub/draftLivePresentation.js",
    also: [
      "frontend/src/DraftHub/DraftNomineeCard.jsx",
      "frontend/src/DraftHub/botPersona.js",
    ],
    doNot: "Do not wrap a live draft in HubExperience two-column settings chrome. Seats inherit DraftSeat from idle Draft and Mock. Never say Available players — the rail eyebrow is Player pool. Auction awards play on the block card (bid pulse, draining clock, 1s SOLD hold) — do not toast a sold result in the header. Hide empty fantasy narrative; a real line is the name tagline. High bid is never gold: blue while winning, primary text otherwise. Bots use locker marks and persona names, never identical emoji robots. Filled position chips are teal, over-max amber, empty muted. Won roster rows pop in like lockers. Simulate pins the block-card layout.",
  }),
  "hub.week": S({
    label: "This Week",
    chrome: "experience",
    route: "/hub/week",
    page: "frontend/src/DraftHub/WeeklyCommandCenter.jsx",
    copy: "frontend/src/DraftHub/weekBoard.js",
    also: [
      "frontend/src/DraftHub/WeekLineupBoard.jsx",
      "frontend/src/DraftHub/WeekLineupCallSheet.jsx",
    ],
    doNot: "Do not fork a second week hero. Extend WeeklyCommandCenter. Hero copy comes from board state: loading, error + Retry, or empty pre-draft with draft night — never No swap worth making over an error. Empty boards use the shared league empty-state (Lock a night / Link Sleeper / Sync league) — not League settings or Rate vibes. Decisions rail says Waiting on roster when there is no roster. Empty starter slots say Empty — never Waiting as a loading chip. Do not render Waiting dashes for eight empty slots on load or error. Inert slots stay flat. Decision count lives in the hero once — not also as Decisions N and a rail headline. Refresh projections sits on the freshness line, not as the decision-panel primary. The board is a slate of editorial rows, not swap cards. Start opens the Ticket sheet (week-pts delta poster; Vegas, prior PPG, def vs pos, kickoff). Sit and start stay side by side on phone. Keep closes. Ticket Start is amber, not a second blue — hide the rail primary while the sheet is open. Wide range is a quiet marker, never a row-wide amber border or primary blue. Reserve the Start slot so P50s share a baseline. Empty K/DEF link to Free agents. Bench uses the same slate rows and spans under the rail. Name the Vibes / VA-projections number. Week uses the Projections stepper. Do not ship the Duel sheet or a stats-table popup.",
  }),
  "hub.vibes": S({
    label: "Vibes",
    chrome: "experience",
    route: "/hub/vibes",
    page: "frontend/src/DraftHub/VibeRankings.jsx",
    copy: "frontend/src/DraftHub/vibeRankingsPresentation.js",
    also: [
      "frontend/src/DraftHub/VibeSwipeDeck.jsx",
      "frontend/src/DraftHub/vibeAura.js",
      "frontend/src/DraftHub/vibeProfile.js",
      "frontend/src/DraftHub/vibeMatchup.js",
      "frontend/src/styles/vibe-rankings.css",
    ],
    doNot: "Reuse HubExperience*. Aura is a personal start weight, not a new accent or award gold. Desktop: card left, Vibe ranking and VA-projections right, both in view. Front card is week-vs-vibe, not a giant cutout. Bio is the one noun for the profile control — labeled Bio, neutral, not accent blue. Sit and Start are equal; Undo is a meta control, not a third option. Sit is not amber. One progress readout lives by the card. Week and vibe week compare; aura is a labeled 0–99 meter. One rate per player per calendar day. VA-projections are research; This Week lineup uses the board number. Empty slots say Empty with Find {POS}. Review on This Week stays hidden until a rating exists. When the deck is done, keep one Review primary on the ranking card — the left column lists today's reads or collapses. Do not scrape Wikipedia. Do not say site board. Do not mention swipe on a pointer desktop.",
  }),
  "hub.game": S({
    label: "Game center",
    chrome: "matchup",
    route: "/hub/game",
    page: "frontend/src/DraftHub/GameCenter.jsx",
    copy: "frontend/src/DraftHub/gameCenterPresentation.js",
    doNot: "Game center is a matchup board, not an editorial settings page. Live renders only inside a game window. Hero names the job (empty lineup cost, then the live score). Pre-draft empty copy is one draft-night sentence to Open draft room — not Link Sleeper or a kickoff wait. Standings share Home's last-season records and stay unranked until a game is played. Do not play last year's Sleeper week as this week's scores. Include the viewer on mobile. Gold only on a claimed trophy. Trophy summary is one flex row, title and value on one baseline. Unscored placeholder chip is No scores yet — never Waiting. Loading uses a skeleton or Loading chip.",
  }),
  "hub.roster": S({
    label: "My team",
    chrome: "table",
    route: "/hub/roster",
    page: "frontend/src/DraftHub/RosterBuilder.jsx",
    copy: "frontend/src/DraftHub/rosterPresentation.js",
    also: ["frontend/src/DraftHub/rosterFormat.js"],
    doNot: "Do not invent a second my-team chrome. List people by owner name. At zero players hide search and position chips and show the shared empty-state. One Contract control per row — history lives in the drawer. Dead cap and if-undone room use rosterFormat.js and never repeat their field labels. The roster table uses page scroll, not an inner max-height. Pack non-player columns to min-content so header and value share an edge. The player-count line sits under the stadium banner, not mid-band. Cap card leads with leftover for draft. Dead cap is a tooltip or inline · $N dead. Staff-only Remove is gated, confirmed, and separated from Queue extension. Contract dialog moves focus to the heading. Filter chips show counts and disable zeros. Extension eligible vs Expiring use different hues. Locker cards are named controls that open the contract panel. Lockers default to top 6 by cap hit unless the owner picked a wall, and they open the contract panel. Player names are the last column to truncate. Mobile cards do not expand a repeated POS/CAP/YRS/STATUS grid.",
  }),
  "hub.rosters": S({
    label: "Rosters",
    chrome: "experience",
    route: "/hub/rosters",
    page: "frontend/src/DraftHub/LeagueRostersBrowser.jsx",
    copy: "frontend/src/DraftHub/leagueRostersPresentation.js",
    doNot: "Reuse HubExperienceHero + HubExperienceLayout + HubExperienceSummary + HubTableCard. Default is the league-wide Overpay/Bargain list; the manager rail is the drill-down and shows free cap, expiring count, and worst overpay. Ten managers is a picker, not a swipe strip. Franchise headers get Propose trade into Trades · Builder with the partner preselected. Contract judgment is the word alone when the dollar delta is zero. Expire chips say Extendable, never a question. Expire chips are sentence case. Overpay rows stay a neutral background — only the delta chip is red. Desktop virtualizes on page scroll — no nested table scroller. Do not offer Add to trade on contracts that will not survive the next draft. Refresh labels name the scope (Refresh league), never sit beside a single manager as if they refresh that roster. Download Excel is ghost beside Refresh — never a second primary. Mobile cards expand into the judgment and actions, not a repeated years/pts grid.",
  }),
  "hub.planner": S({
    label: "Cap",
    chrome: "experience",
    route: "/hub/cap",
    page: "frontend/src/DraftHub/CapPlanner.jsx",
    copy: "frontend/src/DraftHub/capPlannerPresentation.js",
    doNot: "Extend CapPlanner and HubExperience*. Do not start a new cap aesthetic. Every leftover, against-cap, and roster figure names what it counts; against-cap is salary plus dead cap and leftover plus against-cap equals the cap. The move leftover (before/after) sits next to the cut and bid controls — do not leave the consequence in the rail only. The summary-rail primary is leftover / open the room. Undo cut is ghost — never a second blue fill. League spend is a text link. Hero and At a glance keep the current leftover (drop the hero leftover on phone). Do not use native select; use HubFilterMenu. Roster-min needs are one sentence and one Free agents CTA, not six attention rows. Expires uses amber; extend-to-keep uses the blue option chip. Hide empty future-year columns; do not duplicate next year in a Schedule column. Pending-cut and expiring bullets get Undo cut / Contract. Cap sheet rows open the contract drawer or stay flat. Phone spend and sheet are dense vertical rows — no contract carousels. Need-N-more links carry the POS filter to Free agents.",
  }),
  "hub.trades": S({
    label: "Trades",
    chrome: "experience",
    route: "/hub/trades",
    page: "frontend/src/DraftHub/LeagueTrades.jsx",
    copy: "frontend/src/DraftHub/leagueTradesPresentation.js",
    doNot: "Wrap Trades in HubExperienceHero. Zero partners swaps the primary to Invite managers on Members. Continue (or Propose on the last step) is the only primary in the viewport. Accept and Load into builder are ghost. Do not invent a second hero system. Need a partner is status text, never amber. Partner cards use the Rosters manager-rail min-width with Select pinned to the card bottom. The Continue bar right-aligns and drops the extra card chrome. Trades cap line is current roster salary, not My team's {season} committed. Auto-check the package and gate Propose on a pass; put the verdict beside the primary as a live status banner. Partner status is hero text, not a chip CTA. Ideas need chips are starter-thin only.",
  }),
  "hub.rules": S({
    label: "Rules",
    chrome: "rules-center",
    route: "/hub/rules",
    page: "frontend/src/DraftHub/RulesWizard.jsx",
    copy: "frontend/src/DraftHub/rulesPresentation.js",
    doNot: "Do not invent a parallel rules model. Merge via rulesPresentation.js. Templates confirm and fill the form — they do not save. Draft behavior stays an open section. At a glance names saved vs preview. Hero chips are status, not the page primary. Do not put You can edit where Save belongs.",
  }),
  "hub.office": S({
    label: "Roster management",
    chrome: "office",
    route: "/hub/roster-management/contracts",
    page: "frontend/src/DraftHub/LeagueOffice.jsx",
    also: [
      "frontend/src/DraftHub/hubOfficeTabs.js",
      "frontend/src/DraftHub/insights/AwardTitlesEditor.jsx",
    ],
    doNot: "Chat is FantasyChatDock plus the Home thread. Not an office pane. Do not add a Chat tab.",
  }),
  "hub.office.current": S({
    label: "Contracts",
    chrome: "office",
    route: "/hub/roster-management/contracts",
    page: "frontend/src/DraftHub/CommissionerLeagueRosters.jsx",
    copy: "frontend/src/DraftHub/officeContractsPresentation.js",
    also: ["frontend/src/DraftHub/insights/AwardTitlesEditor.jsx"],
    doNot: "Staff may override. Players-tab adds may not. Mark draft complete is a red confirm here — not an unlabeled Setup checkbox. Writes accumulate in a pending-changes tray; Drop executes on save. Extend to keep is teal, Expires — FA is amber, Cut is red. Live-contracts callout is a disclosure like How cap years work — do not nest a second hub-page. Cap / Sheets is a labeled Related pair. Award names is a Roster management control, not an Insights disclosure.",
  }),
  "hub.office.historic": S({
    label: "Salary sheets",
    chrome: "office",
    route: "/hub/roster-management/sheets",
    page: "frontend/src/DraftHub/TeamSalarySheets.jsx",
    doNot: "Keep sheets inside Roster management. Do not add a top-level destination.",
  }),
  "hub.office.members": S({
    label: "Members",
    chrome: "office",
    route: "/hub/roster-management/members",
    page: "frontend/src/DraftHub/LeagueOffice.jsx",
    copy: "frontend/src/DraftHub/leagueAccessCopy.js",
    doNot: "List people by owner name. Do not show a nickname as the only identity. Seat is the slot; manager is the person. Add a seat only past the seat count.",
  }),
  "hub.office.access": S({
    label: "Access & imports",
    chrome: "office",
    route: "/hub/roster-management/access",
    page: "frontend/src/DraftHub/LeagueOffice.jsx",
    copy: "frontend/src/DraftHub/leagueAccessCopy.js",
    also: ["frontend/src/DraftHub/OfficeLeagueLifecycle.jsx"],
    doNot: "Do not invent a second invite or import chrome. Access & imports is the Sleeper link, email-assign, league workbook, and delete. It does not copy the Draft invite link. The strip owns Sync league. Collapse the Sleeper league ID form once the league is linked. Delete requires every commissioner to type the league name and agree.",
  }),
  "hub.insights": S({
    label: "Insights",
    chrome: "experience",
    route: "/hub/insights/overview",
    page: "frontend/src/DraftHub/LeagueInsights.jsx",
    copy: "frontend/src/DraftHub/insights/insightsPresentation.js",
    also: ["frontend/src/DraftHub/insights/InsightsOverview.jsx"],
    doNot: "Gold is for awards only. Overview sells titles, records, and scoring — not Spend. Rank bars share a fixed track and a field scale, not a zero baseline or the value-label width. Scoring gaps from first; the leader reads Leader. Season counts are meta, not chips. Keep the tab strip live and below the hero band — never above it. Skeleton the three cards — no think scrim. Award names live on Roster management. Overview is a three-card page that should sit above the fold; do not stretch unequal panels to a shared bottom.",
  }),
  "hub.setup": S({
    label: "Setup",
    chrome: "office",
    route: "/hub/setup",
    page: "frontend/src/DraftHub/HubSetup.jsx",
    also: ["frontend/src/DraftHub/LeagueSetup.jsx"],
    copy: "frontend/src/DraftHub/leagueAccessCopy.js",
    doNot: "Setup is create/join, connections, and imports; it writes no league state and is not a fourth top-level area. Draft night is read-only status here and lives on Draft. Mark draft complete lives on Roster management · Contracts as a red confirm.",
  }),
  "tools.dfs": S({
    label: "DFS",
    chrome: "experience",
    route: "/tools/dfs",
    page: "frontend/src/LineupOptimizer.jsx",
    copy: "frontend/src/dfsToolPresentation.js",
    doNot: "Reuse experience classes and dfsToolPresentation.js. Do not fork a DFS hero. Hero only — do not restate the hero as a sub-nav tagline. Rail is Your lineup · locked · skipped. Pool table lets the page own vertical scroll and sticks the header. Announce a built lineup and highlight those rows. Exclusive format/goal/stack choices use radiogroup. Season and Week use HubFilterMenu, not a native select. Format cards are 5-up at desktop width. Highest is a corner tag, not a wrapping HIGHEST TOTAL line. Lock/Skip use the same ghost height as Free agents History. Amber never marks Highest.",
  }),
  "tools.mock-draft": S({
    label: "Mock draft",
    chrome: "experience",
    route: "/tools/mock-draft",
    page: "frontend/src/DraftHub/MockDraftTool.jsx",
    copy: "frontend/src/DraftHub/mockDraftConfig.js",
    also: [
      "frontend/src/DraftHub/DraftSeat.jsx",
      "frontend/src/DraftHub/draftSeat.js",
    ],
    doNot: "Idle mock uses this launch page. A running mock uses DraftRoom. Seats use DraftSeat (YOU / 2 / 3), the same component as idle Draft. Number every visible step or drop the numerals. Disclosure summaries show caret, badge, and heading on one row. Mode-select cards describe; the primary button carries the verb. Seat marks that are not selectable are labeled as a fact — do not promise sit. One reassurance in the first viewport — do not stack the same reassurance twice. When matching league rules, field size follows that league. Recent mocks (last 3) sit on the launch rail; empty rail says No mocks yet.",
  }),
  "tools.mock-draft.live": S({
    label: "Mock draft (live)",
    chrome: "draft-live",
    route: "/tools/mock-draft",
    overlay: true,
    page: "frontend/src/DraftHub/DraftRoom.jsx",
    copy: "frontend/src/DraftHub/mockDraftConfig.js",
    also: [
      "frontend/src/DraftHub/DraftSeat.jsx",
      "frontend/src/DraftHub/draftSeat.js",
      "frontend/src/DraftHub/draftLivePresentation.js",
      "frontend/src/DraftHub/DraftNomineeCard.jsx",
      "frontend/src/DraftHub/botPersona.js",
    ],
    doNot: "A live mock is board-first. Same photos as rosters. Never say Available players — the rail eyebrow is Player pool. Practice rooms have no Drop or Trade. Simulate uses live-bot pricing, shows N of the remaining pool, pins the block-card layout, and never disables Discard. Auction awards play on the block card — do not toast a sold result in the header. Hide empty fantasy narrative; a real line is the name tagline. Award now only when the viewer is high bidder. High bid is never gold: blue while winning, primary text otherwise. Bots use locker marks and persona names, never identical emoji robots. Team cards show names; seats are not a grid cell. Filled position chips are teal, over-max amber, empty muted. Recap awards are gold trophy tiles and the page leads with the viewer's grade. Bots jump toward their ceiling; the bid clock extends only on late bids. Empty nomination stage is the player pool with range + why in the gap, not a 300px waiting card.",
  }),
  "tools.best-ball": S({
    label: "Best ball",
    chrome: "experience",
    route: "/tools/best-ball",
    page: "frontend/src/BestBallBoard.jsx",
    copy: "frontend/src/bestBallPresentation.js",
    doNot: "Reuse HubExperience*. Do not invent a fourth top-level area. Leftmost # is monotonic; Pos rank is within position and groups under position headers on that sort. Missing ECR is a No ECR chip and ECR filter, never a dash. Show the No ECR chip in Edge too when ECR is missing. Edge names the ±10 threshold in copy; discount is teal, reach is --tone-negative, never amber. Pos / ECR / Sort are labeled menus. Export lives in the filter bar. The rail H3 is This board, not Board at a glance. Loading uses skeletons, not a text line. Page owns scroll and the list is windowed. Headers name the data (Pos rank, Pos ECR as FantasyPros consensus); ECR or ADP by its real name, never one labeled as the other. Hide Edge sort when the source is ECR-only. Show Scoring: PPR. No roadmap notes in user copy. Team abbreviations match Weekly (LAR, not LA).",
  }),
  "projections.weekly": S({
    label: "Weekly",
    chrome: "board",
    route: "/projections/weekly",
    page: "frontend/src/WeeklyTable.jsx",
    copy: "frontend/src/projectionsPresentation.js",
    also: [
      "frontend/src/ProjectionBoardChrome.jsx",
      "frontend/src/styles/projections-experience.css",
    ],
    doNot: "Projections are a board. Do not wrap them in HubExperienceLayout. Weekly compare is a mode — no always-on checkboxes. Weekly rows match QB/WR/TE: no opportunity/role/commentary chips on the board. One compact injury chip only. Rank stays one line; movement is one muted line under it. Desktop virtualizes on page scroll — no nested table scroller. Do not add a header Refresh on Weekly — the stale or missing-notes chip is the refresh. The notes chip rebuilds player-context only — do not start the weekly ETL pipeline. Phone rows are dense ranking rows; Compare is one toolbar control, never a per-card checkbox. Null prior rank is New, not 0. Phone weekly: swipeable signals, no body movement chips, sticky position+filter+count, windowed list, stale or missing-notes chip is refresh with relative time when one exists. Filter sheet owns search/what-changed with Apply/Reset. No per-card Floor–Ceiling label. Injury context hides while loading and timestamps when ready.",
  }),
  "projections.season": S({
    label: "Season",
    chrome: "board",
    route: "/projections/season",
    page: "frontend/src/DraftTable.jsx",
    copy: "frontend/src/projectionsPresentation.js",
    also: [
      "frontend/src/ProjectionBoardChrome.jsx",
      "frontend/src/styles/projections-experience.css",
    ],
    doNot: "Season is a board, not a Fantasy decision page. Phone rows match weekly density: rank, face, name, P50. Do not invent tall season cards. Season names its own miss — do not reuse the Best ball ADP line.",
  }),
  "projections.inspector": S({
    label: "Player inspector",
    chrome: "board",
    overlay: true,
    page: "frontend/src/PlayerCardModal.jsx",
    copy: "frontend/src/projectionsPresentation.js",
    also: [
      "frontend/src/PlayerContextPanel.jsx",
      "frontend/src/ProjectionExplanationPanel.jsx",
    ],
    doNot: "Desktop inspector is a right drawer. Hero-first: one P50, floor/ceiling inline, one read strip. Do not restore the 2×2 insight grid. Do not invent a second player card. This-week notes are locker or practice plus an optional projection delta. Do not show YouTube show copy as current week. Inline the position's typical miss. Empty note is No usable note this week.",
  }),
  "account.model": S({
    label: "Model accuracy",
    chrome: "account",
    route: "/model",
    page: "frontend/src/AccuracyChart.jsx",
    copy: "frontend/src/accuracyPresentation.js",
    doNot: "Account-only. Do not add Model accuracy to top-level nav. Tiles name the position. Hide empty season charts. First stat tile is a neutral surface, not accent blue.",
  }),
  "account.admin": S({
    label: "Admin",
    chrome: "account",
    route: "/admin",
    page: "frontend/src/AdminPortal.jsx",
    copy: "frontend/src/adminPresentation.js",
    doNot: "Account-only. Do not add Admin to top-level nav. Owner-to-team attach after signup lives here until a Fantasy flow exists.",
  }),
  "account.account": S({
    label: "Account",
    chrome: "account",
    route: "/account",
    page: "frontend/src/AccountSettingsPage.jsx",
    also: ["frontend/src/AccountAuth.jsx"],
    doNot: "Account-only. Do not add Account to top-level nav.",
  }),
  "account.report": S({
    label: "Report a bug",
    chrome: "account",
    route: "/report",
    page: "frontend/src/BugReportPage.jsx",
    copy: "frontend/src/bugReportPresentation.js",
    also: [
      "frontend/src/layout/UserMenu.jsx",
      "frontend/src/layout/MobileMenuSheet.jsx",
    ],
    doNot: "Account-only side option. Do not add Report a bug to top-level nav or invent a fourth product area. Tickets land on SCORE Jira with labels user-reported and pickup. User copy does not say pickup board.",
  }),
  "account.login": S({
    label: "Sign in",
    chrome: "account",
    route: "/login",
    page: "frontend/src/AuthSessionPage.jsx",
    copy: "frontend/src/authPresentation.js",
    also: ["frontend/src/AccountAuth.jsx", "frontend/src/styles/auth-session.css"],
    doNot: "Account-only session page. Do not wrap in Fantasy experience chrome.",
  }),
  "account.register": S({
    label: "Create account",
    chrome: "account",
    route: "/register",
    page: "frontend/src/AuthSessionPage.jsx",
    copy: "frontend/src/authPresentation.js",
    also: ["frontend/src/AccountAuth.jsx", "frontend/src/styles/auth-session.css"],
    doNot: "Account-only session page. Do not wrap in Fantasy experience chrome.",
  }),
  "account.privacy": S({
    label: "Privacy",
    chrome: "account",
    route: "/privacy",
    page: "frontend/src/legal/PrivacyPage.jsx",
    copy: "frontend/src/legal/legalPresentation.js",
    doNot: "Standalone legal page. Do not wrap in Fantasy experience chrome. Privacy names the SMS vendor and that mobile numbers are not shared, including in the early sections.",
  }),
  "account.terms": S({
    label: "Terms",
    chrome: "account",
    route: "/terms",
    page: "frontend/src/legal/TermsPage.jsx",
    copy: "frontend/src/legal/legalPresentation.js",
    doNot: "Standalone legal page. Do not wrap in Fantasy experience chrome.",
  }),
  "account.sms-alerts": S({
    label: "Draft alert texts",
    chrome: "account",
    route: "/sms-alerts",
    page: "frontend/src/legal/SmsAlertsPage.jsx",
    copy: "frontend/src/legal/legalPresentation.js",
    also: ["frontend/src/legal/SmsOptInCard.jsx", "frontend/src/AccountSettingsPage.jsx"],
    doNot: "Public A2P opt-in card. Content first. Do not wrap in Fantasy experience chrome.",
  }),
});

/** Longer aliases win so "mock draft" beats "draft". */
export const SURFACE_ALIASES = Object.freeze({
  "fantasy home": "hub.home",
  "action center": "hub.home",
  "league home": "hub.home",
  "league chat button": "hub.home",
  "move the league chat": "hub.home",
  "league chat": "hub.home",
  "chat bubble": "hub.home",
  "not scheduled": "hub.home",
  "draft night not scheduled": "hub.home",
  "value sheet": "hub.value",
  "suggested bid": "hub.value",
  "hub ppr": "hub.value",
  strategy: "hub.value",
  "draft strategy": "hub.value",
  "draft strategy page": "hub.value",
  "view my rankings": "hub.value",
  "strategy face-off": "hub.value",
  "site vs mine": "hub.value",
  "free agents": "hub.available",
  "available players": "hub.available",
  "live auction": "hub.room.live",
  "live draft": "hub.room.live",
  "live room": "hub.room.live",
  "nominee card": "hub.room.live",
  "draft nominee": "hub.room.live",
  "draft lobby": "hub.room",
  "draft calendar": "hub.room",
  "draft night": "hub.room",
  "league invite": "hub.room",
  "the room": "hub.room",
  "open seats": "hub.room",
  "take a pick": "hub.room",
  "mark yours": "hub.room",
  "lock a night": "hub.room",
  "this week": "hub.week",
  "command center": "hub.week",
  "waiting on roster": "hub.week",
  "rate vibes": "hub.week",
  "vibe rankings": "hub.vibes",
  "vibe ranking": "hub.vibes",
  "tinder profile": "hub.vibes",
  "fun facts about the player": "hub.vibes",
  "info arrow": "hub.vibes",
  "see more on the card": "hub.vibes",
  "va-projections": "hub.vibes",
  "vibe adjusted projections": "hub.vibes",
  vibes: "hub.vibes",
  aura: "hub.vibes",
  "game center": "hub.game",
  matchup: "hub.game",
  "my team": "hub.roster",
  "my roster": "hub.roster",
  "salary sheets": "hub.office.historic",
  "roster management": "hub.office",
  "access & imports": "hub.office.access",
  "delete league": "hub.office.access",
  "delete this league": "hub.office.access",
  "download excel": "hub.rosters",
  "league workbook": "hub.rosters",
  "mock draft": "tools.mock-draft",
  "best ball": "tools.best-ball",
  "player inspector": "projections.inspector",
  "this-week notes": "projections.inspector",
  "locker note": "projections.inspector",
  "player card": "projections.inspector",
  "model accuracy": "account.model",
  "preseason outlook": "projections.season",
  "live season": "projections.season",
  "weekly compare": "projections.weekly",
  "running back weekly": "projections.weekly",
  "mobile weekly": "projections.weekly",
  "phone projections": "projections.weekly",
  weekly: "projections.weekly",
  "attention tile": "projections.weekly",
  season: "projections.season",
  rosters: "hub.rosters",
  contracts: "hub.office.current",
  "draft done": "hub.office.current",
  "mark draft complete": "hub.office.current",
  members: "hub.office.members",
  "invite managers": "hub.office.members",
  insights: "hub.insights",
  trades: "hub.trades",
  rules: "hub.rules",
  office: "hub.office",
  cap: "hub.planner",
  draft: "hub.room",
  home: "hub.home",
  dfs: "tools.dfs",
  lineup: "tools.dfs",
  admin: "account.admin",
  account: "account.account",
  "report a bug": "account.report",
  "bug report": "account.report",
  "pickup board": "account.report",
  "send a report": "account.report",
  login: "account.login",
  "sign in": "account.login",
  "create account": "account.register",
  register: "account.register",
  signup: "account.register",
  "privacy policy": "account.privacy",
  privacy: "account.privacy",
  "terms of service": "account.terms",
  terms: "account.terms",
  "draft alert texts": "account.sms-alerts",
  "sms opt-in": "account.sms-alerts",
  "web form opt-in": "account.sms-alerts",
});

export function getLivingSurface(id) {
  return LIVING_SURFACES[id] || null;
}

export function resolveLivingSurface({
  section = null,
  hubView = null,
  toolsTab = null,
  projectionsTab = null,
  officeTab = null,
  draftLive = false,
  inspector = false,
} = {}) {
  if (inspector) return getLivingSurface("projections.inspector");
  if (section === "projections") {
    return getLivingSurface(`projections.${projectionsTab || "weekly"}`);
  }
  if (section === "tools") {
    if (toolsTab === "mock-draft" && draftLive) {
      return getLivingSurface("tools.mock-draft.live");
    }
    return getLivingSurface(`tools.${toolsTab}`);
  }
  if (section === "hub") {
    if (hubView === "room" && draftLive) return getLivingSurface("hub.room.live");
    if (hubView === "office" && officeTab) {
      return getLivingSurface(`hub.office.${officeTab}`) || getLivingSurface("hub.office");
    }
    return getLivingSurface(`hub.${hubView}`);
  }
  if (section === "model") return getLivingSurface("account.model");
  if (section === "admin") return getLivingSurface("account.admin");
  if (section === "account") return getLivingSurface("account.account");
  if (section === "report") return getLivingSurface("account.report");
  return null;
}

function textHasAlias(hay, alias) {
  if (alias.includes(" ")) return hay.includes(alias);
  return new RegExp(`(^|[^a-z0-9])${alias}([^a-z0-9]|$)`).test(hay);
}

export function resolveLivingSurfaceFromText(text) {
  const hay = String(text || "").toLowerCase();
  const aliases = Object.keys(SURFACE_ALIASES).sort((a, b) => b.length - a.length);
  for (const alias of aliases) {
    if (textHasAlias(hay, alias)) return getLivingSurface(SURFACE_ALIASES[alias]);
  }
  return null;
}

function rowMentionsFile(row, path) {
  if (row.page === path || row.copy === path) return true;
  return Array.isArray(row.also) && row.also.includes(path);
}

export function surfacesForFile(repoPath) {
  const path = String(repoPath || "").replace(/\\/g, "/");
  const hits = Object.entries(LIVING_SURFACES)
    .filter(([, row]) => rowMentionsFile(row, path))
    .map(([id, row]) => ({ id, ...row }));
  if (hits.length) return hits;
  const sharedPaths = Object.values(SHARED).flat();
  if (sharedPaths.includes(path)) {
    return [{ id: "shared", label: "Shared chrome", chrome: "experience", page: path }];
  }
  return [];
}

/** Unique audit/verify URLs. Overlay rows (live draft, inspector) are skipped. */
export function livingSurfaceRoutes() {
  const seen = new Set();
  const rows = [];
  for (const [id, row] of Object.entries(LIVING_SURFACES)) {
    if (!row?.route || row.overlay) continue;
    if (seen.has(row.route)) continue;
    seen.add(row.route);
    rows.push({ id, route: row.route, label: row.label });
  }
  return rows;
}
