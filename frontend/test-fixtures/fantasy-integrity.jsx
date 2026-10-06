// Production components with isolated data; all API requests and writes are mocked.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import RulesWizard from "../src/DraftHub/RulesWizard";
import WeekLineupBoard from "../src/DraftHub/WeekLineupBoard";
import ValueSheetTable from "../src/DraftHub/ValueSheetTable";
import GameCenter from "../src/DraftHub/GameCenter";
import { TeamIdentityProvider } from "../src/DraftHub/TeamIdentityContext";
import { DEFAULT_RULES } from "../src/DraftHub/rulesPresentation";
import "../src/styles.css";
import "../src/styles/fantasy.css";
import "../src/styles/product-hierarchy.css";
import "../src/styles/projections-experience.css";
import "../src/styles/product-rhythm.css";
import "../src/styles/fantasy-phone.css";
import "../src/styles/fantasy-header.css";
import "../src/styles/standalone-dialogs.css";
import "../src/styles/color-theme.css";
import "../src/styles/lineup-picker.css";
import "../src/styles/weekly-experience.css";
import "../src/styles/fantasy-chat.css";

const params = new URLSearchParams(location.search);
const view = params.get("view") || "rules", salary = params.get("format") === "salary", linked = params.get("host") === "sleeper", state = params.get("state") || "live";
const sharedReview = params.get("review") === "shared";
const availableRows = [{ player_id: "fa-player", player: "Isaiah Likely", position: "TE", team: "BAL", status: "available", season_proj: 120, season_p50: 120, season_p10: 90, season_p90: 160, fair_value: 8, pos_rank: 8, tier: "Tier 2", per_game_proj: 7.1, season_spread: 70, min_sal: 1, max_sal: 20, risk_score: 0.4 },
  ...(sharedReview ? [{ player_id: "fa-k", player: "Brandon Aubrey", position: "K", team: "DAL", status: "available", season_proj: 130, season_p50: 130, season_p10: 105, season_p90: 150, fair_value: 5, pos_rank: 2, tier: "Tier 2", per_game_proj: 7.6, season_spread: 45, min_sal: 1, max_sal: 8, risk_score: 0.2 },
    { player_id: "fa-def", player: "Baltimore Ravens", position: "DEF", team: "BAL", status: "available", season_proj: 100, season_p50: 100, season_p10: 60, season_p90: 150, fair_value: 4, pos_rank: 12, tier: "Tier 3", per_game_proj: 5.9, season_spread: 90, min_sal: 1, max_sal: 8, risk_score: 0.6 }] : [])];
const rules = { ...DEFAULT_RULES, draft_type: salary ? "auction" : "snake", playoffs: { ...DEFAULT_RULES.playoffs, enabled: true } };
const context = { mode: "league", league_id: "integrity-fixture", team_id: "mine", league_name: "Bottom to Top", team_name: "Sunday Roster", owner_name: "Maya Chen", season: 2026,
  rules, draft_completed: true, is_commissioner: true, capabilities: { uses_salaries: salary, uses_contracts: salary }, ...(linked ? { sleeper_league_id: "fixture-linked" } : {}) };
const future = { player_id: "future", player_name: "Isaiah Likely", position: "TE", team: "BAL", p50: 9.4, kickoff_available: true, lineup_locked: false };
const started = { player_id: "started", player_name: "Travis Kelce", position: "TE", team: "KC", p50: 11.7, kickoff_available: true, lineup_locked: true };
const unknown = { player_id: "unknown", player_name: "Unknown kickoff", position: "WR", team: "BUF", p50: 12, kickoff_available: false, lineup_locked: true };
const slotPlan = [{ key: "te", slot: "TE", player: started }, { key: "flex", slot: "FLEX", player: future }, { key: "wr", slot: "WR", player: unknown }, { key: "k", slot: "K", player: null }, { key: "def", slot: "DEF", player: null }];
const starters = (suffix, holes = false) => [
  { player_id: `te-${suffix}`, name: "Isaiah Likely", position: "TE", team: "BAL", points: state === "pregame" ? null : 4.2, proj: 9.4, pregame_projection: 9.4, game_state: state === "final" ? "final" : "live" },
  { player_id: holes ? "" : `k-${suffix}`, name: holes ? "Empty" : "Brandon Aubrey", position: "K", team: "DAL", points: holes || state === "pregame" ? null : 3, proj: 8.2, pregame_projection: 8.2, game_state: state === "final" ? "final" : "pregame" },
  { player_id: holes ? "" : `def-${suffix}`, name: holes ? "Empty" : "Baltimore Ravens", position: "DEF", team: "BAL", points: holes || state === "pregame" ? null : 2, proj: 7, pregame_projection: 7, game_state: state === "final" ? "final" : "pregame" },
];
const gameTeams = ["mine", "other", "third", "fourth"].map((id, i) => ({ roster_id: String(i + 1), hub_team_id: id, is_viewer: i === 0, owner_name: ["Maya Chen", "Jordan Davis", "Morgan Lee", "Alex Rivera"][i], team_name: ["Sunday Roster", "Sunday Rivals", "Mountain Kings", "Midnight Blitz"][i], points: state === "pregame" ? null : 9.2, starters: starters(id, i === 3), bench_players: [] }));
window.fixtureRequests = []; window.fixtureWrites = []; window.fixtureActions = [];
window.fetch = async (input, options = {}) => {
  const path = String(input); window.fixtureRequests.push(path);
  if (options.method && options.method !== "GET") window.fixtureWrites.push({ path, body: JSON.parse(options.body || "{}") });
  if (path.includes("fa-market/bid")) return Response.json({ bid: { bid_amount: JSON.parse(options.body).bid_amount } });
  if (path.endsWith("/claims") && options.method === "PUT") return Response.json({ claims: JSON.parse(options.body).claims });
  if (path.includes("/workspace") && options.method === "PUT") return Response.json({ saved: JSON.parse(options.body) });
  if (path.includes("fa-market")) return Response.json({ market: { my_claims: [], waiver_priority: { confirmed: true, current_team_id: "mine", teams: [{ team_id: "mine", team_name: "Maya Chen", priority: 1 }, { team_id: "other", team_name: "Jordan Davis", priority: 2 }] } } });
  if (path.includes("live-scoring")) return Response.json({ available: true, source: linked ? "sleeper" : "scoresense", season: 2026, week: 4, current_week: 4, max_week: 18,
    scoring_status: state, scoring_errors: state === "error" ? ["Missing required statistics"] : [], week_complete: state === "final", live: state === "live", placeholder: state === "pregame", viewer_matchup_id: "1", starting_slots: ["TE", "K", "DEF"],
    scoring_control: { scored: state === "final", slate_complete: state === "final", run: null }, matchups: [{ matchup_id: "1", teams: gameTeams.slice(0, 2) }, { matchup_id: "2", teams: gameTeams.slice(2) }], standings: [], synced_at: new Date().toISOString() });
  return Response.json({ identities: {}, players: [], media: {}, teams: [] });
};
function Preview() {
  const [selected, setSelected] = useState("");
  const action = (kind, value) => window.fixtureActions.push({ kind, value });
  return <main id="main-content"><div className="draft-hub">
    {view === "rules" && <RulesWizard workspace={{ id: "fixture", name: context.league_name, season: 2026, rules }} hubContext={context} />}
    {view === "week" && <WeekLineupBoard weekLabel="Week 4" weekValue={4} slots={slotPlan} bench={[{ ...future, player_id: "benchfuture", player_name: "Future bench player" }, { ...started, player_id: "benchstarted", player_name: "Locked bench player" }]} canEdit={!linked} selectedBenchId={selected}
      onSelectBench={p => { setSelected(p.player_id); action("bench", p.player_id); }} compact onOpenSlot={s => action("slot", s.key)} onFillSlot={s => action("fill", s.slot)} onWeekChange={() => {}} />}
    {view === "agents" && <ValueSheetTable leagueId="integrity-fixture" season={2026} inLeague pickDraft={!salary} rules={rules} mode="available" acquisitionWindow={{ add_mode: ["instant", "nocap"].includes(state) ? "add" : state === "locked" ? "locked" : salary ? "bid" : "claim", message: state === "instant" ? "Free agency is open" : state === "locked" ? "Adds open after the draft" : "Waivers are open" }} title="Free agents" rosterIds={new Set()} sleeper={[]}
      rows={["loading", "empty"].includes(state) ? [] : availableRows} loading={state === "loading"} remainingCap={state === "nocap" ? 0 : 25} roster={[{ player_id: "drop-player", player_name: "Bench player", position: "WR" }]}
      showAdvancedColumns={state === "advanced" ? true : undefined}
      onOpenContractHistory={sharedReview ? (pid) => action("history", pid) : undefined}
      onWatchPlayer={sharedReview ? (row) => action("watch", row.player_id) : undefined} />}
    {view === "game" && <TeamIdentityProvider leagueId="integrity-fixture"><GameCenter weekly renderLineup={() => null} leagueId="integrity-fixture" hubContext={context} requestedWeek={4} requestedTeam={params.get("team") || "third"} onNavigate={v => action("navigate", v)} /></TeamIdentityProvider>}
  </div></main>;
}
createRoot(document.getElementById("root")).render(<MemoryRouter initialEntries={[`/hub/${view}`]}><Preview /></MemoryRouter>);
