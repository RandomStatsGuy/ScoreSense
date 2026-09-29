// Production lineup components with isolated, deterministic writes; never contacts a league.
import React, {useState} from "react";
import LeagueContextBanner from "../src/DraftHub/LeagueContextBanner";
import {LeagueChromeProvider} from "../src/DraftHub/LeagueChromeContext";
import MobileHeader from "../src/layout/MobileHeader";
import MobileShell from "../src/layout/MobileShell";
import MobileMenuSheet from "../src/layout/MobileMenuSheet";
import DesktopPrimaryHeader from "../src/layout/DesktopPrimaryHeader";
import useMobileLayout from "../src/useMobileLayout";
import { createRoot } from "react-dom/client";
import WeeklyExperience from "../src/DraftHub/WeeklyExperience";
import HubSubnav from "../src/DraftHub/HubSubnav.jsx";
import {MemoryRouter} from "react-router-dom";
import {TeamIdentityProvider} from "../src/DraftHub/TeamIdentityContext";
import "../src/styles/fantasy-header.css";
import "../src/styles.css";
import "../src/styles/fantasy.css";
import "../src/styles/product-hierarchy.css";
import "../src/styles/product-rhythm.css";
import "../src/styles/fantasy-phone.css";
import "../src/styles/color-theme.css";

const params = new URLSearchParams(location.search);
const state = params.get("state") || "ready";
const recorded = ["live", "native-progress", "final"].includes(state);
const player = (id, name, position, team, p50, slot = "BN") => ({
  player_id: id, player_name: name, position, team, p50, slot,
  kickoff_et: "2030-09-22T13:00:00-04:00", p10: 6, p90: 28,
});
const rules = { roster: { qb: { starter: 1 }, rb: { starter: 1 }, wr: { starter: 1 }, te: { starter: 0 },
  k: { starter: 0 }, def: { starter: 0 }, flex: { starter: 1, eligible: ["RB", "WR", "TE"] } } };
const context = { mode: "league", league_id: "fixture", team_id: "mine", team_name: "Sunday Roster",
  draft_completed: !params.has("preseason") && state !== "no-roster", is_commissioner:!params.has("member"), capabilities:{uses_salaries:params.has("salary"), uses_contracts:params.has("salary")}, rules, ...(state === "linked" ? { sleeper_league_id: "fixture" } : {}) };
const data = {
  hub_context: context,
  meta: { season: 2026, week: 2, lineup_source: state === "linked" ? "sleeper" : "hub", lineup_locked: ["readonly", "final"].includes(state), week_scored: ["readonly", "final"].includes(state), projections_built_at: new Date().toISOString() },
  status: {}, sync: {}, counts: { roster: 7, missing_projections: 0 }, decisions: [],
  roster: { starters: [player("hurts", "Jalen Hurts", "QB", "PHI", 22.4, "QB"),
    player("bijan", "Bijan Robinson", "RB", "ATL", 19.8, "RB"),
    player("lamb", "CeeDee Lamb", "WR", "DAL", 21.2, "WR"),
    player("waddle", "Jaylen Waddle", "WR", "MIA", 12.6, "FLEX")],
    bench: [player("smith", "DeVonta Smith", "WR", "PHI", 15.1),
      player("charbonnet", "Zach Charbonnet", "RB", "SEA", 10.4),
      player("daniels", "Jayden Daniels", "QB", "WAS", 21.5)] },
};
if (state === "empty") data.roster.starters = data.roster.starters.filter((p) => p.slot !== "FLEX");
if (state === "no-options") data.roster.bench = [data.roster.bench[2]];
if (state === "locked-player") data.roster.bench[0].locked = true;
if (state === "locked-starter") data.roster.starters[3].locked = true;
if (state === "missing") data.roster.bench[0].p50 = null;
if (state === "calls") data.decisions=[{starter_player_id:"waddle",starter_player_name:"Jaylen Waddle",starter_slot:"FLEX",bench_player_id:"smith",bench_player_name:"DeVonta Smith",delta_p50:2.5}];
window.fixtureWrites = [];
window.fetch = async (input, options = {}) => {
  const path = String(input);
  window.fixtureRequests ||= [];
  window.fixtureRequests.push(path);
  if (path.includes("live-scoring")) {
    if(state === "score-error") return Response.json({detail:"Matchup unavailable"},{status:503});
    const week = Number(new URL(path, location.origin).searchParams.get("week") || 2);
    const mine={roster_id:"1",hub_team_id:"mine",owner_name:"Tessa",team_name:"Tessa's Revenge",is_viewer:true,points:recorded ? 42.3 : 0,
      starters:data.roster.starters.map(p=>({player_id:p.player_id,name:p.player_name,position:p.position,team:p.team,proj:state === "missing" ? null : p.p50,points:0})),bench_players:[]};
    if (state === "specialists") mine.starters.push({name:"Kicker",position:"K",proj:8.4,projection_source:"rank_curve"});
    const other={roster_id:"2",hub_team_id:"other",owner_name:"Alex",team_name:"Sunday Rivals",points:recorded ? 37.8 : 0,
      starters:[{name:"Josh Allen",position:"QB",team:"BUF",proj:21,points:10},{name:"Saquon Barkley",position:"RB",team:"PHI",proj:20,points:5},{name:"Justin Jefferson",position:"WR",team:"MIN",proj:18,points:0},{name:"Trey McBride",position:"TE",team:"ARI",proj:12,points:0}],bench_players:[]};
    return Response.json({available:true,source:"hub",reason:"hub",placeholder:!recorded,live:state==="live",week_complete:state==="final",season:2026,week,current_week:state === "native-progress" ? week + 1 : 2,max_week:18,
      ...(["native-progress", "final"].includes(state) ? {scoring_control:{host:"native",scored:true,final:state === "final",live:state !== "final",slate_complete:state === "final"}} : {}),
      viewer_matchup_id:"one",starting_slots:["QB","RB","WR","FLEX"],matchups:[{matchup_id:"one",teams:[mine,other]},{matchup_id:"two",teams:[{roster_id:"3",owner_name:"Sam",points:60},{roster_id:"4",owner_name:"Jamie",points:52}]}],standings:[]});
  }
  if (path.includes("freshness")) return Response.json({sleeper:{linked:state === "linked"},projections:{available:true}});
  if (path.includes("identities")) return Response.json({identities:{}});
  if (path.includes("/lineup")) {
    window.fixtureWrites.push({ path, method: options.method, body: JSON.parse(options.body) });
    if (state === "write-error") return Response.json({ detail: "Game started. This player is locked." }, { status: 409 });
    await new Promise((resolve) => setTimeout(resolve, 150));
    const payload = JSON.parse(options.body);
    if (path.endsWith("/swap")) {
      const incoming = data.roster.bench.find((p) => p.player_id === payload.bench_player_id);
      const outgoing = data.roster.starters.find((p) => p.player_id === payload.starter_player_id);
      data.roster.starters = data.roster.starters.map((p) => p === outgoing ? { ...incoming, slot: outgoing.slot } : p);
      data.roster.bench = data.roster.bench.map((p) => p === incoming ? { ...outgoing, slot: "BN" } : p);
    } else {
      const pool = [...data.roster.starters, ...data.roster.bench];
      data.roster.starters = payload.starters.map((s) => ({ ...pool.find((p) => p.player_id === s.player_id), slot: s.slot }));
      data.roster.bench = pool.filter((p) => !payload.starters.some((s) => s.player_id === p.player_id));
    }
    data.decisions=[];
    return Response.json({ saved: true });
  }
  if (path.startsWith("/api/hub/week")) {
    if (state === "no-roster") { data.roster={starters:[],bench:[]}; data.status={empty_roster:true,unlinked_league:true}; data.counts.roster=0; }
    if (state === "loading") await new Promise(() => {});
    if (state === "load-error") return Response.json({ detail: "Unavailable" }, { status: 503 });
    const week=Number(new URL(path,location.origin).searchParams.get("week") || 2); return Response.json({...data,meta:{...data.meta,week}});
  }
  if (path.includes("/vibe-aura")) return Response.json({ aura_by_player_id: {} });
  return Response.json({ media: Object.fromEntries([
    ["hurts", 4040715], ["bijan", 4430809], ["lamb", 4241389], ["waddle", 4372016],
    ["smith", 4241478], ["charbonnet", 4426385], ["daniels", 4426348],
  ].map(([id, espn]) => [id, { headshot_url: `https://a.espncdn.com/i/headshots/nfl/players/full/${espn}.png` }])) });
};
function Preview() {
  const [ctx,setContext]=useState({...context,league_name:params.has("long") ? "The Extremely Long Fantasy Football League Name" : "Bottom to Top"});
  const [picker,setPicker]=useState(false),[more,setMore]=useState(false);
  const mobile=useMobileLayout();
  const navigate=(view,extra)=>{window.fixtureDestination=view;window.fixtureNavigationExtra=extra;setPicker(false);};
  const members=[{league_id:"fixture",league_name:ctx.league_name,team:{id:"mine",name:"Sunday Roster"}},{league_id:"second",league_name:"Sunday league",team:{id:"mine",name:"Sunday Roster"}}];
  return <LeagueChromeProvider><MobileShell className="app--compact-league" section="hub" onSectionChange={navigate} onMoreOpen={()=>setMore(true)} hrefForSection={id=>"#"+id}>
    <a className="app-skip-link" href="#main-content">Skip to content</a>
    <header className="app-header app-header--hub app-header--product app-header--compact-league"><div className="app-header-shell app-header-shell--hub">
      <MobileHeader title="This Week" hasMenu menuOpen={picker} onTitleClick={()=>setPicker(true)} compactLeague onMoreOpen={()=>setMore(true)} />
      <DesktopPrimaryHeader productName="ScoreSense" studioName="4th Down Labs" sections={[{id:"projections",label:"Projections"},{id:"hub",label:"Fantasy"},{id:"tools",label:"Tools"}]} view="hub" pathForSection={id=>"#"+id} onNavigate={navigate} />
      <HubSubnav subView="week" hubContext={ctx} onNavigate={navigate} mobileLayout={mobile} pickerOnly={mobile} pickerOpen={picker} onPickerOpenChange={setPicker} />
    </div></header>
    <main id="main-content"><div className="draft-hub"><TeamIdentityProvider leagueId={ctx.league_id}>
      <LeagueContextBanner hubContext={ctx} memberships={members} onLeagueSwitch={()=>setContext(prev=>({...prev,league_id:"second",league_name:"Sunday league"}))} onCreateLeague={()=>{}} onLeagueSync={()=>{}} showAttention={false} currentView="week" />
      <WeeklyExperience hubContext={ctx} requestedWeek={params.get("week")} requestedTeam={params.get("matchupTeam")} onNavigate={navigate} />
    </TeamIdentityProvider></div></main>
    <MobileMenuSheet open={more} onClose={()=>setMore(false)} authReady authenticated user={{name:"Tessa"}} onGoToAccount={()=>navigate("account")} view="hub" />
  </MobileShell></LeagueChromeProvider>;
}
createRoot(document.getElementById("root")).render(<MemoryRouter><Preview /></MemoryRouter>);
