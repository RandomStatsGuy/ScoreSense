// Production Home, isolated API responses, and no real league writes.
import React from "react";
import { createRoot } from "react-dom/client";
import LeagueHome from "../src/DraftHub/LeagueHome";
import { TeamIdentityProvider } from "../src/DraftHub/TeamIdentityContext";
import "../src/styles.css";
import "../src/styles/fantasy.css";
import "../src/styles/product-hierarchy.css";
import "../src/styles/product-rhythm.css";
import "../src/styles/fantasy-phone.css";
import "../src/styles/color-theme.css";
import "../src/styles/fantasy-chat.css";

const params = new URLSearchParams(location.search);
const state = params.get("state") || "pregame";
const salary = params.get("format") !== "pick";
const staff = params.get("role") !== "member";
const pre = state === "pre";
const native = params.get("host") === "native";
const projected = ["pregame", "missing"].includes(state);
if (params.get("theme") === "light") document.documentElement.dataset.theme = "light";
const context = { mode: "league", league_id: "home-fixture", team_id: "mine", draft_completed: !pre, is_commissioner: staff, is_primary_commissioner: staff, sleeper_league_id: native ? null : "fixture-sleeper" };
const standings = [
  { roster_id: "1", hub_team_id: "mine", owner_name: "Caleb K", team_name: "Sunday Service", wins: 4, losses: 1, rank: 1, points_for: 653.2 },
  { roster_id: "2", hub_team_id: "other", owner_name: "Jordan D", team_name: "Ragdollin With Mahomies", wins: 3, losses: 2, rank: 2, points_for: 632.8 },
  { roster_id: "3", hub_team_id: "third", owner_name: "Sam M", team_name: "Sunday Squad", wins: 3, losses: 2, rank: 3, points_for: 610.4 },
  { roster_id: "4", hub_team_id: "fourth", owner_name: "Morgan T", team_name: "Goal Line", wins: 3, losses: 2, rank: 4, points_for: 598.1 },
  { roster_id: "5", hub_team_id: "fifth", owner_name: "Jamie P", team_name: "Fourth & Long", wins: 2, losses: 3, rank: 5, points_for: state === "missing" ? null : 575.6 },
  { roster_id: "6", hub_team_id: "sixth", owner_name: "Alex R", team_name: "End Zone", wins: 2, losses: 3, rank: 6, points_for: 570.2 },
];
const gameState = state === "live" || state === "zero" ? "live" : state === "final" ? "final" : "pregame";
const teams = standings.slice(0,2).map((row,i) => ({ ...row, is_viewer:i === 0, proj_total:state === "missing" && i === 0 ? null : [122.6,115.8][i], points:state === "zero" ? 0 : state === "live" ? [25.4,3][i] : state === "final" ? [128.4,112.7][i] : 0,
  starters:[{ name:i ? "Opponent starter" : "Your starter", player_id:`p${i}`, game_state:gameState, proj:state === "missing" && i === 0 ? null : [122.6,115.8][i] }] }));
const home = { phase:{ id:pre ? "pre_draft" : "in_season", label:pre ? "Pre-draft" : "In season", primary_cta:{ view:"room", label:"Choose a night" } },
  cap:salary ? { uses_salaries:true, salary_cap:200, remaining:42 } : { uses_salaries:false, roster_size:15 }, actions:pre ? [{ id:"draft_night", message:"Choose your draft night.", href:"room" }] : [{ id:"lineup_decisions", count:2, href:"week" }],
  seating:{ team_count:12, claimed:12, open_seats:0 }, draft_schedule:null, hub_context:context, checklist:{default_view:"room"} };
let messages = [
  { id:"m1", team_id:"other", owner_name:"Jordan D", body:"Sorry Caleb, this is my week.", created_at:new Date().toISOString(), reactions:[{emoji:"😂",count:3,mine:false}] },
  { id:"m2", team_id:"mine", owner_name:"Caleb K", body:"Let's revisit this on Monday.", created_at:new Date().toISOString(), reactions:[] },
];
window.fixtureRequests = []; window.fixtureWrites = []; window.fixtureActions = [];
window.fetch = async (input, options={}) => {
  const path=String(input); window.fixtureRequests.push(path);
  if(options.method && options.method !== "GET")window.fixtureWrites.push({path,method:options.method,body:options.body});
  if(path.includes('/api/hub/home')) {
    if(state === "loading")await new Promise(resolve=>setTimeout(resolve,15000));
    if(state === "error")return Response.json({detail:"Home unavailable"},{status:503});
    return Response.json(home);
  }
  if(path.includes('live-scoring')) {
    if(state === "scoring-error")return Response.json({detail:"Scoring unavailable"},{status:503});
    return Response.json({available:true, home_display_mode:projected ? "projected" : "scores", season:2026, week:6, current_week:6, week_complete:state === "final", live:gameState === "live", placeholder:pre || (native && projected), source:native ? "hub" : "sleeper", reason:native && projected ? "hub_unscored" : undefined, viewer_matchup_id:"1", standings:pre || state === "empty" ? [] : standings,
      scoring_control:{host:native ? "native" : "sleeper"}, matchups:pre || state === "empty" ? [] : [{matchup_id:"1",teams}]});
  }
  if(path.includes('/chat/summary'))return Response.json({members:standings.map(row=>({id:row.hub_team_id,name:row.owner_name,team_name:row.team_name,is_staff:staff,can_message:true})),threads:[]});
  if(path.includes('/chat/thread/')) {
    if(options.method === "POST") {
      const message={id:"new",team_id:"mine",owner_name:"Caleb K",body:JSON.parse(options.body).body,created_at:new Date().toISOString(),reactions:[]};
      messages=[...messages,message]; return Response.json({message});
    }
    return Response.json({messages});
  }
  if(path.includes('/reactions')) {
    const message={...messages[0],reactions:[{emoji:"😂",count:4,mine:true}]};
    messages=[message,...messages.slice(1)];return Response.json({message});
  }
  return Response.json({identities:{},members:[],messages:[]});
};
function Preview() {
  return <><div style={{padding:16,color:"var(--text-secondary)",fontSize:12}}>Home B · Sample data</div><a className="app-skip-link" href="#main-content">Skip to content</a><main id="main-content" className="app"><div className="draft-hub">
    <TeamIdentityProvider leagueId={context.league_id}><LeagueHome hubContext={context} onNavigate={(view,extra)=>window.fixtureActions.push({view,extra})} /></TeamIdentityProvider>
  </div></main></>;
}
createRoot(document.getElementById('root')).render(<Preview />);
