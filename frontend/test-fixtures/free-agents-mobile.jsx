// Real components with isolated sample data. Every league write is intercepted here.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import ValueSheetTable from "../src/DraftHub/ValueSheetTable";
import LeagueContextBanner from "../src/DraftHub/LeagueContextBanner";
import { LeagueChromeProvider } from "../src/DraftHub/LeagueChromeContext";
import MobileHeader from "../src/layout/MobileHeader";
import MobileShell from "../src/layout/MobileShell";
import DesktopPrimaryHeader from "../src/layout/DesktopPrimaryHeader";
import MobileMenuSheet from "../src/layout/MobileMenuSheet";
import HubSubnav from "../src/DraftHub/HubSubnav.jsx";
import useMobileLayout from "../src/useMobileLayout";
import "../src/styles/fantasy-header.css";
import "../src/styles.css";
import "../src/styles/fantasy.css";
import "../src/styles/product-hierarchy.css";
import "../src/styles/product-rhythm.css";
import "../src/styles/fantasy-phone.css";
import "../src/styles/color-theme.css";
import "../src/styles/standalone-dialogs.css";

const params = new URLSearchParams(location.search), state = params.get("state") || "bid";
const pick = ["claim", "priority", "claim-error", "market-error", "add"].includes(state) || params.has("pick");
const mode = ["claim", "priority", "claim-error", "market-error"].includes(state) ? "claim" : ["predraft", "locked"].includes(state) ? "locked" : state === "add" ? "add" : "bid";
const rules = { draft_type: pick ? "snake" : "auction", scoring_profile: "hub_ppr", risk_tolerance: 0, salary_cap: 200 };
const acquisition = { add_mode: mode, label: mode === "bid" ? "Waivers · Bidding" : mode === "claim" ? "Waivers" : mode === "add" ? "Free agency" : "Pre-draft", message: mode === "locked" ? "Adds open after the draft" : "Player additions follow the league calendar." };
let rows = [
  ["9500", "Josh Downs", "WR", "IND", 172, 128, 224, 10.8, 9],
  ["8676", "Rashid Shaheed", "WR", "SEA", 160, 103, 216, 10, 8],
  ["9508", "Tyjae Spears", "RB", "TEN", 148, 97, 202, 9.3, 7],
  ["9484", "Tucker Kraft", "TE", "GB", 142, 98, 188, 8.9, 6],
  ["10232", "Michael Wilson", "WR", "ARI", 139, 91, 190, 8.7, 5],
  ["8131", "Isaiah Likely", "TE", "NYG", 125, 83, 177, 7.8, 4],
  ["4943", "Sam Darnold", "QB", "SEA", 264, 210, 313, 16.5, 3],
  ["8134", "Khalil Shakir", "WR", "BUF", 122, 90, 166, 7.6, 2],
].map(([player_id, player, position, team, season_p50, season_p10, season_p90, per_game_proj, fair_value], i) => ({ player_id, player: params.has("long") && !i ? "An Exceptionally Long Player Name With Several Surnames" : player, position, team, season_p50, season_proj: season_p50, season_p10, season_p90, per_game_proj, fair_value, tier: "Tier 3", status: "available", season_quantile_method: "mc_schedule_v1" }));
const photos = Object.fromEntries(rows.map(r => [r.player_id, { headshot_url: `https://sleepercdn.com/content/nfl/players/thumb/${r.player_id}.jpg` }]));
if (["empty", "loading"].includes(state)) rows = [];
if (state === "missing") rows = [{ ...rows[0], season_p50: null, season_proj: null, season_p10: null, season_p90: null, per_game_proj: null, fair_value: null }];
if (state === "large") rows = Array.from({ length: 240 }, (_, i) => ({ ...rows[i % 8], player_id: `sample-${i}`, player: `Player ${String(i).padStart(3, "0")}`, fair_value: 240 - i }));
let claims = [], priority = { confirmed: state !== "priority", current_team_id: "mine", teams: [{ team_id: "mine", team_name: "Maya Chen", priority: 1 }, { team_id: "other", team_name: "Jordan Davis", priority: 2 }] };
const roster = [{ player_id: "bench", player_name: "Bench Player", position: "WR", team: "BUF" }];
window.fixtureWrites = [];
window.fetch = async (input, options = {}) => {
  const path = String(input);
  if (options.method && options.method !== "GET") {
    const body = JSON.parse(options.body || "{}");
    window.fixtureWrites.push({ path, method: options.method, body });
    if (["write-error", "claim-error"].includes(state)) return Response.json({ detail: "The league could not save this move. Try again." }, { status: 503 });
    if (path.endsWith("/claims")) claims = body.claims;
    if (path.endsWith("/priority")) priority = { ...priority, confirmed: true, teams: body.team_ids.map((id, i) => ({ ...priority.teams.find(t => t.team_id === id), priority: i + 1 })) };
    return Response.json({ claims, priority, high_bid: { high_bid: body.bid_amount } });
  }
  if (path.includes("/fa-market")) return state === "market-error" ? Response.json({ detail: "Could not load waiver claims" }, { status: 503 }) : Response.json({ market: { my_claims: claims, waiver_priority: priority, protected_player_ids: params.has("protected") ? ["9500"] : [] } });
  if (path.includes("/players/media")) return Response.json({ media: photos });
  if (path.includes("freshness")) return Response.json({ sleeper: { linked: false }, projections: { available: true } });
  return Response.json({});
};

function Preview() {
  const [ctx, setContext] = useState({ mode: "league", league_id: "fixture", team_id: "mine", owner_name: "Maya Chen", league_name: params.has("long") ? "The Extremely Long Fantasy Football League Name" : "Bottom to Top", draft_completed: mode !== "locked", rules, acquisition_window: acquisition, is_commissioner: state === "priority", capabilities: { uses_salaries: !pick, uses_contracts: !pick } });
  const [watch, setWatch] = useState([]), [picker, setPicker] = useState(false), [more, setMore] = useState(false), [version, setVersion] = useState(0);
  const mobile = useMobileLayout();
  const navigate = view => { window.fixtureDestination = view; setPicker(false); };
  return <LeagueChromeProvider><MobileShell className="app--compact-league" section="hub" onSectionChange={navigate} onMoreOpen={() => setMore(true)} hrefForSection={id => "#" + id}>
    <a className="app-skip-link" href="#main-content">Skip to content</a>
    <header className="app-header app-header--hub app-header--product app-header--compact-league"><div className="app-header-shell app-header-shell--hub">
      <MobileHeader title="Free agents" hasMenu menuOpen={picker} onTitleClick={() => setPicker(true)} compactLeague onMoreOpen={() => setMore(true)} />
      <DesktopPrimaryHeader productName="ScoreSense" studioName="4th Down Labs" sections={[{ id: "projections", label: "Projections" }, { id: "hub", label: "Fantasy" }, { id: "tools", label: "Tools" }]} view="hub" pathForSection={id => "#" + id} onNavigate={navigate} />
      <HubSubnav subView="available" hubContext={ctx} onNavigate={navigate} mobileLayout={mobile} pickerOnly={mobile} pickerOpen={picker} onPickerOpenChange={setPicker} />
    </div></header>
    <main id="main-content"><div className="draft-hub">
      <LeagueContextBanner hubContext={ctx} memberships={[{ league_id: "fixture", league_name: ctx.league_name, team: { id: "mine", name: "Sunday Roster" } }]} onLeagueSwitch={() => setContext(c => ({ ...c, league_id: "second" }))} onCreateLeague={() => {}} onLeagueSync={() => {}} showAttention={false} currentView="available" />
      <ValueSheetTable key={ctx.league_id} mode="available" rows={rows} loading={state === "loading"} season={2026} inLeague leagueId={ctx.league_id} acquisitionWindow={acquisition} rules={rules} pickDraft={pick} preDraft={mode === "locked"} remainingCap={params.has("lowcap") ? 3 : 42} roster={roster} rosterIds={new Set()} watchIds={watch} onWatchPlayer={r => setWatch(ids => ids.includes(r.player_id) ? ids.filter(id => id !== r.player_id) : [...ids, r.player_id])} onAddToRoster={() => { setVersion(version + 1); }} onOpenContractHistory={payload => { window.fixtureHistory = payload; }} isCommissioner={ctx.is_commissioner} actionsDisabled={state === "readonly"} />
    </div></main>
    <MobileMenuSheet open={more} onClose={() => setMore(false)} authReady authenticated user={{ name: "Maya Chen" }} onGoToAccount={() => navigate("account")} view="hub" />
  </MobileShell></LeagueChromeProvider>;
}
createRoot(document.getElementById("root")).render(<MemoryRouter><Preview /></MemoryRouter>);
