// Production Insights components with isolated responses; no league is contacted.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import LeagueInsights from "../src/DraftHub/LeagueInsights";
import LeagueContextBanner from "../src/DraftHub/LeagueContextBanner";
import { LeagueChromeProvider } from "../src/DraftHub/leagueChromeContext";
import HubSubnav from "../src/DraftHub/HubSubnav.jsx";
import MobileHeader from "../src/layout/MobileHeader";
import MobileShell from "../src/layout/MobileShell";
import DesktopPrimaryHeader from "../src/layout/DesktopPrimaryHeader";
import useMobileLayout from "../src/useMobileLayout";
import "../src/styles.css";
import "../src/styles/fantasy.css";
import "../src/styles/product-hierarchy.css";
import "../src/styles/product-rhythm.css";
import "../src/styles/fantasy-phone.css";
import "../src/styles/fantasy-header.css";
import "../src/styles/color-theme.css";

const params = new URLSearchParams(location.search);
const host = params.get("host") || "native", salary = params.get("format") === "salary", state = params.get("state") || "ready";
const rules = { draft_type: salary ? "auction" : "snake", salary_cap: 200, roster: {} };
const context = { mode: "league", league_id: "insights-fixture", team_id: "1", owner_name: "Maya Chen",
  team_name: "Sunday Roster", league_name: "Bottom to Top", season: 2026, draft_completed: true,
  is_commissioner: false, rules, capabilities: { uses_salaries: salary, uses_contracts: salary }, ...(host === "sleeper" ? { sleeper_league_id: "sleeper-fixture" } : {}) };
const names = ["Sunday Roster", "Sunday Rivals", "Mountain Kings", "Midnight Blitz", "Fourth & Forever", "Coastal Crew"];
const owners = ["Maya Chen", "Jordan Davis", "Morgan Lee", "Alex Rivera", "Taylor Reed", "Sam Carter"];
const standings = names.map((team_name, i) => ({ roster_id: String(i + 1), team_id: String(i + 1), owner_id: `owner${i}`,
  team_name, owner_name: owners[i], wins: state === "empty" ? 0 : 4 - Math.floor(i / 2), losses: state === "empty" ? 0 : Math.floor(i / 2), ties: 0,
  rank: state === "empty" ? null : i + 1, points_for: state === "empty" ? 0 : 560 - i * 40, points_against: state === "empty" ? 0 : 490 + i * 15,
  total_points: state === "empty" ? 0 : 560 - i * 40, avg_points: state === "empty" ? 0 : 140 - i * 10, weeks_scored: state === "empty" ? 0 : 4,
  games: state === "empty" ? 0 : 4, win_pct: (4 - Math.floor(i / 2)) / 4 }));
const common = { hub_context: context, planning_season: 2026, owner_map: Object.fromEntries(names.map((name, i) => [name, owners[i]])),
  analytics: { teams: [], positions: [] }, historic: { available: false }, efficiency: { available: false }, ownership: { players: [] } };
const landing = { available: true, source: host === "native" ? "scoresense" : "sleeper", current_season: "2026", current_standings: standings,
  record_leaders: standings, scoring_leaders: standings, seasons_included: ["2026"], has_records: state !== "empty",
  synced_at: "2026-10-05T18:00:00Z", partial: false, seasons: ["2026"], season_summaries: [{ season: "2026", standings, preseason: state === "empty" }], champions: state === "empty" ? [] : [{ season: "2025", team_name: names[0], owner_name: owners[0], owner_id: "owner0", runner_up: names[1] }], most_titles: state === "empty" ? null : { season: "2025", team_name: names[0], owner_name: owners[0], owner_id: "owner0", titles: 1, runner_up: names[1] } };
const scoring = { available: true, source: host === "native" ? "scoresense" : "sleeper", season: "2026", requested_season: "2026",
  available_seasons: ["2026"], standings, awards: salary ? [] : [{ id: "cap_efficiency_goat", title: "Salary award", headline: "5 pts/$", team_name: names[0], tone: "good" }], preseason: state === "empty", weeks: state === "empty" ? [] : [{ week: 1, teams: standings.map(r => ({ ...r, points: r.avg_points })) }],
  player_seasons: state === "empty" ? [] : [{ player_id: "p1", player_name: "Amon-Ra St. Brown", roster_id: "1", owner_name: owners[0], team_name: names[0], season: "2026", started_points: 58.5, starts: 4 },
    { player_id: "p2", player_name: "Isaiah Likely", roster_id: "2", owner_name: owners[1], team_name: names[1], season: "2026", started_points: 31, starts: 4 }] };
window.fixtureRequests = []; window.fixtureWrites = [];
window.fetch = async (input, options = {}) => {
  const path = String(input); window.fixtureRequests.push(path);
  if (options.method && options.method !== "GET") window.fixtureWrites.push(path);
  if (state === "loading") return new Promise(() => {});
  if (state === "error") return Response.json({ detail: "Saved scoring is unavailable" }, { status: 503 });
  if (path.includes("/insights/overview")) return Response.json({ ...common, landing });
  if (path.includes("/insights/scoring")) return Response.json({ ...common, scoring });
  return Response.json({ ...common });
};

function Preview() {
  const [tab, setTab] = useState("overview");
  const mobile = useMobileLayout();
  return <LeagueChromeProvider><MobileShell className="app--compact-league" section="hub" onSectionChange={() => {}} hrefForSection={id => `#${id}`}>
    <a className="app-skip-link" href="#main-content">Skip to content</a>
    <header className="app-header app-header--hub app-header--product app-header--compact-league"><div className="app-header-shell app-header-shell--hub">
      <MobileHeader title="Insights" compactLeague />
      <DesktopPrimaryHeader productName="ScoreSense" studioName="4th Down Labs" sections={[{ id: "projections", label: "Projections" }, { id: "hub", label: "Fantasy" }, { id: "tools", label: "Tools" }]} view="hub" pathForSection={id => `#${id}`} onNavigate={() => {}} />
      <HubSubnav subView="insights" hubContext={context} onNavigate={() => {}} mobileLayout={mobile} pickerOnly={mobile} />
    </div></header>
    <main id="main-content"><div className="draft-hub">
      <LeagueContextBanner hubContext={context} memberships={[{ league_id: context.league_id, league_name: context.league_name, team: { id: "1", name: names[0] } }]} onLeagueSwitch={() => {}} onCreateLeague={() => {}} showAttention={false} currentView="insights" />
      <LeagueInsights leagueId={context.league_id} hubContext={context} activeTab={tab} onActiveTabChange={setTab} onNavigate={() => {}} />
    </div></main>
  </MobileShell></LeagueChromeProvider>;
}
createRoot(document.getElementById("root")).render(<MemoryRouter initialEntries={["/hub/insights/overview"]}><Preview /></MemoryRouter>);
