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
    page: "frontend/src/DraftHub/LeagueHome.jsx",
    copy: "frontend/src/DraftHub/leagueHomePresentation.js",
    doNot: "Do not wrap Home in HubExperienceLayout. Extend the action deck. House the league thread in the locker rail. Do not show the edge launcher on Home. Do not add a Chat destination. Draft night · Not scheduled links to Draft. Clear chat is staff-only, red, and confirms. Home names the roster hole over a commissioner invite. Hide Your matchup / Standings when pre-draft with no scored week. Gate the hero on load — never Fill the seats over unresolved data. After 3s of loading, the action deck names the Sleeper sync. Also due does not style a count like a link. On phone, a one-row league strip (name + caret) sits under the picker — do not restack a second league card in the overflow.",
  }),
  "hub.value": S({
    label: "Strategy",
    chrome: "board",
    page: "frontend/src/DraftHub/StrategyBoard.jsx",
    copy: "frontend/src/DraftHub/strategyRankPresentation.js",
    also: [
      "frontend/src/DraftHub/strategyRank.js",
      "frontend/src/styles/strategy-board.css",
    ],
    doNot: "Do not add HubExperience hero chrome. Face-off is the Strategy page (full-page cards). Cards show a larger player photo on a faded team backdrop. Pairs are the same position only. View my rankings opens site vs mine. Not a leftover-cap spreadsheet and not a Vibes clone. Never show Hub in the scoring label. Suggested bid names scoring and Rules risk posture.",
  }),
  "hub.available": S({
    label: "Free agents",
    chrome: "table",
    page: "frontend/src/DraftHub/ValueSheetTable.jsx",
    copy: "frontend/src/DraftHub/acquisitionWindow.js",
    doNot: "Do not add a second pickup board. Players-tab adds follow the calendar. Suggested bid names scoring and Rules risk posture. Never show Hub in user copy. Pre-draft rows show a Locked chip that says Star queues for the room. Vs cost is — only when the bid is missing; pre-draft the cell is Room after. Mobile cards keep the bid as a muted SUGGESTED value — Star is the one action.",
  }),
  "hub.room": S({
    label: "Draft",
    chrome: "experience",
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
    doNot: "Idle Draft uses experience chrome and one featured job: the shared calendar. Live rooms do not. Calendar shows current and future times only. Lock draft night from any shown overlap, or the tapped hour even when no overlap exists yet. Once locked, the hero is Draft night is locked. Fill the room. and the calendar collapses to a one-line disclosure. Keep the date/time form, invite essays, and a second seat list collapsed unless the calendar is Closed and no night is locked — then the off-calendar lock is open as the card primary and Mark yours is gone. Start live draft stays secondary until a night is locked or the room is full. Seating pill counts claimed teams and is amber below a full room, teal only at 12/12. Locked night shows in the viewer timezone; Draft setup names league time once. Room seat tiles keep token padding and product type — do not pack Take flush to the chip. Use DraftSeat so Mock and the live room inherit Open · Take / YOU. On phone, calendar sits above Draft setup; invite/copy live under Share the room; one status chip replaces Locked in / Times saved.",
  }),
  "hub.room.live": S({
    label: "Draft (live)",
    chrome: "draft-live",
    page: "frontend/src/DraftHub/DraftRoom.jsx",
    doNot: "Do not wrap a live draft in HubExperience two-column settings chrome. Seats inherit DraftSeat from idle Draft and Mock.",
  }),
  "hub.week": S({
    label: "This Week",
    chrome: "experience",
    page: "frontend/src/DraftHub/WeeklyCommandCenter.jsx",
    copy: "frontend/src/DraftHub/weekBoard.js",
    also: ["frontend/src/DraftHub/WeekLineupBoard.jsx"],
    doNot: "Do not fork a second week hero. Extend WeeklyCommandCenter. Hero copy comes from board state: loading, error + Retry, or empty pre-draft with draft night — never No swap worth making over an error. Empty boards use the shared league empty-state (Lock a night / Link Sleeper / Sync league) — not League settings or Rate vibes. Decisions rail says Waiting on roster when there is no roster. Empty starter slots say Empty — never Waiting as a loading chip. Do not render Waiting dashes for eight empty slots on load or error. Inert slots stay flat. Decision count lives in the hero once — not also as Decisions N and a rail headline. Refresh projections sits on the freshness line, not as the decision-panel primary. Swap cards use attention amber with a Start control; wide range is a quiet marker, never a card-wide amber border or primary blue. Reserve the swap-action slot so P50s share a baseline. Empty K/DEF link to Free agents. Bench uses the same cards and spans under the rail. Name the Vibes / VA-projections number. Week uses the Projections stepper.",
  }),
  "hub.vibes": S({
    label: "Vibes",
    chrome: "experience",
    page: "frontend/src/DraftHub/VibeRankings.jsx",
    copy: "frontend/src/DraftHub/vibeRankingsPresentation.js",
    also: [
      "frontend/src/DraftHub/VibeSwipeDeck.jsx",
      "frontend/src/DraftHub/vibeAura.js",
      "frontend/src/DraftHub/vibeProfile.js",
      "frontend/src/DraftHub/vibeMatchup.js",
      "frontend/src/styles/vibe-rankings.css",
    ],
    doNot: "Reuse HubExperience*. Aura is a personal start weight, not a new accent or award gold. Front card is matchup only. Bio and latest news stay behind the info arrow. One swipe per player per calendar day. VA-projections show vibe week, including K and DEF. Do not scrape Wikipedia. Review on This Week stays hidden until a roster exists. Info arrow is neutral, not accent blue.",
  }),
  "hub.game": S({
    label: "Game center",
    chrome: "matchup",
    page: "frontend/src/DraftHub/GameCenter.jsx",
    copy: "frontend/src/DraftHub/gameCenterPresentation.js",
    doNot: "Game center is a matchup board, not an editorial settings page. Live renders only inside a game window. Hero names the job (empty lineup cost, then the live score). Pre-draft empty copy is one draft-night sentence to Open draft room — not Link Sleeper or a kickoff wait. Standings share Home's last-season records and stay unranked until a game is played. Do not play last year's Sleeper week as this week's scores. Include the viewer on mobile. Gold only on a claimed trophy. Unscored placeholder chip is No scores yet — never Waiting. Loading uses a skeleton or Loading chip.",
  }),
  "hub.roster": S({
    label: "My team",
    chrome: "table",
    page: "frontend/src/DraftHub/RosterBuilder.jsx",
    copy: "frontend/src/DraftHub/rosterPresentation.js",
    also: ["frontend/src/DraftHub/rosterFormat.js"],
    doNot: "Do not invent a second my-team chrome. List people by owner name. At zero players hide search and position chips and show the shared empty-state. One Contract control per row — history lives in the drawer. Dead cap and if-undone room use rosterFormat.js. Mobile cards do not expand a repeated POS/CAP/YRS/STATUS grid.",
  }),
  "hub.rosters": S({
    label: "Rosters",
    chrome: "experience",
    page: "frontend/src/DraftHub/LeagueRostersBrowser.jsx",
    copy: "frontend/src/DraftHub/leagueRostersPresentation.js",
    doNot: "Reuse HubExperienceHero + HubTableCard. Do not fork a roster browser. Franchise headers get Propose trade into Trades · Builder with the partner preselected.",
  }),
  "hub.planner": S({
    label: "Cap",
    chrome: "experience",
    page: "frontend/src/DraftHub/CapPlanner.jsx",
    copy: "frontend/src/DraftHub/capPlannerPresentation.js",
    doNot: "Extend CapPlanner and HubExperience*. Do not start a new cap aesthetic. Every leftover, against-cap, and roster figure names what it counts; against-cap is salary plus dead cap and leftover plus against-cap equals the cap. The move leftover (before/after) sits next to the cut and bid controls — do not leave the consequence in the rail only. The summary-rail primary is the move — undo a cut or open the room to spend leftover; League spend is a text link. Hero and At a glance keep the current leftover (drop the hero leftover on phone). Do not use native select; use HubFilterMenu. Roster-min needs are one sentence and one Free agents CTA, not six attention rows. Expires uses amber; extend-to-keep uses the blue option chip. Hide empty future-year columns; do not duplicate next year in a Schedule column. Pending-cut and expiring bullets get Undo cut / Contract. Cap sheet rows open the contract drawer or stay flat. Phone spend and sheet are dense vertical rows — no contract carousels. Need-N-more links carry the POS filter to Free agents.",
  }),
  "hub.trades": S({
    label: "Trades",
    chrome: "experience",
    page: "frontend/src/DraftHub/LeagueTrades.jsx",
    copy: "frontend/src/DraftHub/leagueTradesPresentation.js",
    doNot: "Wrap Trades in HubExperienceHero. Zero partners swaps the primary to Invite managers on Members. Do not invent a second hero system. Trades cap line is current roster salary, not My team's {season} committed. Auto-check the package and gate Propose on a pass; put the verdict beside the primary as a live status banner. Partner status is hero text, not a chip CTA. Ideas need chips are starter-thin only.",
  }),
  "hub.rules": S({
    label: "Rules",
    chrome: "rules-center",
    page: "frontend/src/DraftHub/RulesWizard.jsx",
    copy: "frontend/src/DraftHub/rulesPresentation.js",
    doNot: "Do not invent a parallel rules model. Merge via rulesPresentation.js. Templates confirm and fill the form — they do not save. Draft behavior stays an open section. At a glance names saved vs preview.",
  }),
  "hub.office": S({
    label: "Roster management",
    chrome: "office",
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
    page: "frontend/src/DraftHub/CommissionerLeagueRosters.jsx",
    copy: "frontend/src/DraftHub/officeContractsPresentation.js",
    also: ["frontend/src/DraftHub/insights/AwardTitlesEditor.jsx"],
    doNot: "Staff may override. Players-tab adds may not. Mark draft complete is a red confirm here — not an unlabeled Setup checkbox. Writes accumulate in a pending-changes tray; Drop executes on save. Extend to keep is teal, Expires — FA is amber, Cut is red. Award names is a Roster management control, not an Insights disclosure.",
  }),
  "hub.office.historic": S({
    label: "Salary sheets",
    chrome: "office",
    page: "frontend/src/DraftHub/TeamSalarySheets.jsx",
    doNot: "Keep sheets inside Roster management. Do not add a top-level destination.",
  }),
  "hub.office.members": S({
    label: "Members",
    chrome: "office",
    page: "frontend/src/DraftHub/LeagueOffice.jsx",
    copy: "frontend/src/DraftHub/leagueAccessCopy.js",
    doNot: "List people by owner name. Do not show a nickname as the only identity. Seat is the slot; manager is the person. Add a seat only past the seat count.",
  }),
  "hub.office.access": S({
    label: "Access & imports",
    chrome: "office",
    page: "frontend/src/DraftHub/LeagueOffice.jsx",
    copy: "frontend/src/DraftHub/leagueAccessCopy.js",
    doNot: "Do not invent a second invite or import chrome. Access & imports is the Sleeper link and email-assign only. It does not copy the Draft invite link. The strip owns Sync league. Collapse the Sleeper league ID form once the league is linked.",
  }),
  "hub.insights": S({
    label: "Insights",
    chrome: "experience",
    page: "frontend/src/DraftHub/LeagueInsights.jsx",
    copy: "frontend/src/DraftHub/insights/insightsPresentation.js",
    also: ["frontend/src/DraftHub/insights/InsightsOverview.jsx"],
    doNot: "Gold is for awards only. Overview sells titles, records, and scoring — not Spend. Rank bars share a fixed track and a field scale, not a zero baseline or the value-label width. Season counts are meta, not chips. Keep the tab strip live and skeleton the three cards — no think scrim. Award names live on Roster management.",
  }),
  "hub.setup": S({
    label: "Setup",
    chrome: "office",
    page: "frontend/src/DraftHub/HubSetup.jsx",
    also: ["frontend/src/DraftHub/LeagueSetup.jsx"],
    copy: "frontend/src/DraftHub/leagueAccessCopy.js",
    doNot: "Setup is create/join, connections, and imports; it writes no league state and is not a fourth top-level area. Draft night is read-only status here and lives on Draft. Mark draft complete lives on Roster management · Contracts as a red confirm.",
  }),
  "tools.dfs": S({
    label: "DFS",
    chrome: "experience",
    page: "frontend/src/LineupOptimizer.jsx",
    copy: "frontend/src/dfsToolPresentation.js",
    doNot: "Reuse experience classes and dfsToolPresentation.js. Do not fork a DFS hero. Hero only — do not restate the hero as a sub-nav tagline. Rail is Your lineup · locked · skipped.",
  }),
  "tools.mock-draft": S({
    label: "Mock draft",
    chrome: "experience",
    page: "frontend/src/DraftHub/MockDraftTool.jsx",
    copy: "frontend/src/DraftHub/mockDraftConfig.js",
    also: [
      "frontend/src/DraftHub/DraftSeat.jsx",
      "frontend/src/DraftHub/draftSeat.js",
    ],
    doNot: "Idle mock uses this launch page. A running mock uses DraftRoom. Seats use DraftSeat (YOU / 2 / 3), the same component as idle Draft. Number every visible step or drop the numerals. Disclosure summaries show a caret. Mode cards describe; the primary carries the verb. Seat marks that are not selectable are labeled as a fact — do not promise sit. One reassurance in the first viewport. When matching league rules, field size follows that league. Recent mocks (last 3) sit on the launch rail.",
  }),
  "tools.mock-draft.live": S({
    label: "Mock draft (live)",
    chrome: "draft-live",
    page: "frontend/src/DraftHub/DraftRoom.jsx",
    doNot: "A live mock is board-first. Same photos as rosters.",
  }),
  "tools.best-ball": S({
    label: "Best ball",
    chrome: "experience",
    page: "frontend/src/BestBallBoard.jsx",
    copy: "frontend/src/bestBallPresentation.js",
    doNot: "Reuse HubExperience*. Do not invent a fourth top-level area. Leftmost # is monotonic; Pos rank is within position and groups under position headers on that sort. Missing ECR is a No ECR chip and ECR filter, never a dash. Edge names the ±10 threshold in copy; discount is teal, reach is --tone-negative, never amber. Pos / ECR / Sort are labeled menus. Export leads the rail; only With ECR repeats as a number. Page owns scroll and the list is windowed. Headers name the data (Pos rank, Pos ECR as FantasyPros consensus); ECR or ADP by its real name, never one labeled as the other. Hide Edge sort when the source is ECR-only. Edge is blank, not 0, when either side is missing. Show Scoring: PPR. No roadmap notes in user copy. Team abbreviations match Weekly (LAR, not LA).",
  }),
  "projections.weekly": S({
    label: "Weekly",
    chrome: "board",
    page: "frontend/src/WeeklyTable.jsx",
    copy: "frontend/src/projectionsPresentation.js",
    also: [
      "frontend/src/ProjectionBoardChrome.jsx",
      "frontend/src/styles/projections-experience.css",
    ],
    doNot: "Projections are a board. Do not wrap them in HubExperienceLayout. Weekly compare is a mode — no always-on checkboxes. Weekly rows match QB/WR/TE: no opportunity/role/commentary chips on the board. One compact injury chip only. Phone rows are dense ranking rows; Compare is one toolbar control, never a per-card checkbox. Null prior rank is New, not 0. Phone weekly: swipeable signals, no body movement chips, sticky position+filter+count, windowed list, stale chip is refresh with relative time. Filter sheet owns search/what-changed with Apply/Reset. No per-card Floor–Ceiling label. Injury context hides while loading and timestamps when ready.",
  }),
  "projections.season": S({
    label: "Season",
    chrome: "board",
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
    page: "frontend/src/AccuracyChart.jsx",
    copy: "frontend/src/accuracyPresentation.js",
    doNot: "Account-only. Do not add Model accuracy to top-level nav. Tiles name the position. Hide empty season charts. First stat tile is a neutral surface, not accent blue.",
  }),
  "account.admin": S({
    label: "Admin",
    chrome: "account",
    page: "frontend/src/AdminPortal.jsx",
    copy: "frontend/src/adminPresentation.js",
    doNot: "Account-only. Do not add Admin to top-level nav. Owner-to-team attach after signup lives here until a Fantasy flow exists.",
  }),
  "account.account": S({
    label: "Account",
    chrome: "account",
    page: "frontend/src/AccountSettingsPage.jsx",
    also: ["frontend/src/AccountAuth.jsx"],
    doNot: "Account-only. Do not add Account to top-level nav.",
  }),
  "account.report": S({
    label: "Report a bug",
    chrome: "account",
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
    page: "frontend/src/AuthSessionPage.jsx",
    copy: "frontend/src/authPresentation.js",
    also: ["frontend/src/AccountAuth.jsx", "frontend/src/styles/auth-session.css"],
    doNot: "Account-only session page. Do not wrap in Fantasy experience chrome.",
  }),
  "account.register": S({
    label: "Create account",
    chrome: "account",
    page: "frontend/src/AuthSessionPage.jsx",
    copy: "frontend/src/authPresentation.js",
    also: ["frontend/src/AccountAuth.jsx", "frontend/src/styles/auth-session.css"],
    doNot: "Account-only session page. Do not wrap in Fantasy experience chrome.",
  }),
  "account.privacy": S({
    label: "Privacy",
    chrome: "account",
    page: "frontend/src/legal/PrivacyPage.jsx",
    copy: "frontend/src/legal/legalPresentation.js",
    doNot: "Standalone legal page. Do not wrap in Fantasy experience chrome. Privacy names the SMS vendor and that mobile numbers are not shared, including in the early sections.",
  }),
  "account.terms": S({
    label: "Terms",
    chrome: "account",
    page: "frontend/src/legal/TermsPage.jsx",
    copy: "frontend/src/legal/legalPresentation.js",
    doNot: "Standalone legal page. Do not wrap in Fantasy experience chrome.",
  }),
  "account.sms-alerts": S({
    label: "Draft alert texts",
    chrome: "account",
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
