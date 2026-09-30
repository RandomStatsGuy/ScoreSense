// Real Fantasy shell, isolated account data, delayed bootstrap; no production API.
import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthContext } from "../src/AuthContext";
import DraftHub from "../src/DraftHub/DraftHub";
import FantasyPerformanceListener from "../src/FantasyPerformanceListener";
import { startFantasyDiagnostics } from "../src/fantasyPerformance";
import "../src/styles.css";
import "../src/styles/product-hierarchy.css";
import "../src/styles/product-rhythm.css";
import "../src/styles/fantasy-phone.css";
import "../src/styles/fantasy-header.css";

const rules = {roster:{qb:{starter:1},rb:{starter:0},wr:{starter:0},te:{starter:0},k:{starter:0},def:{starter:0},flex:{starter:0}}};
const context = {mode:"league",league_id:"fixture",league_name:"Fixture league",team_id:"mine",team_name:"Sunday Roster",season:2026,draft_completed:true,rules};
const starter = {player_id:"hurts",player_name:"Jalen Hurts",position:"QB",team:"PHI",slot:"QB",p50:22.4,p10:10,p90:32,kickoff_et:"2030-09-22T13:00:00-04:00"};
window.fixtureWrites = [];
history.replaceState(null, "", "/hub/week?fantasyPerf=1");
startFantasyDiagnostics();
window.fixtureWorkspaceResolvedAt = 0;
window.fetch = async (input, options = {}) => {
  const path = String(input);
  if (options.method && !["GET","HEAD"].includes(options.method)) window.fixtureWrites.push(path);
  if (path.includes("/api/hub/workspace")) {
    await new Promise(resolve => setTimeout(resolve, 1200));
    window.fixtureWorkspaceResolvedAt = Date.now();
    return Response.json({season:2026,rules,hub_context:context,memberships:[],prefs:{}});
  }
  if (path.includes("/api/hub/week")) return Response.json({hub_context:context,meta:{season:2026,week:4,lineup_source:"hub",lineup_locked:false,week_scored:false},status:{},sync:{},counts:{roster:1,missing_projections:0},decisions:[],roster:{starters:[starter],bench:[]}});
  if (path.includes("/live-scoring")) return Response.json({available:true,source:"hub",placeholder:true,season:2026,week:4,current_week:4,max_week:18,starting_slots:["QB"],standings:[],scoring_control:{host:"native",final:false},viewer_matchup_id:"match",matchups:[{matchup_id:"match",teams:[{roster_id:"mine",hub_team_id:"mine",owner_name:"You",team_name:"Sunday Roster",is_viewer:true,points:0,starters:[{player_id:"hurts",name:"Jalen Hurts",position:"QB",slot:"QB",proj:22.4}]},{roster_id:"opponent",owner_name:"Opponent",team_name:"Next Sunday",is_opponent:true,points:0,starters:[{player_id:"other",name:"Josh Allen",position:"QB",slot:"QB",proj:23}]}]}]});
  return Response.json({presets:[],memberships:[],teams:[],media:{},aura_by_player_id:{}});
};
const fixtureFetch = window.fetch;
window.fetch = async (...args) => {
  const response = await fixtureFetch(...args);
  response.headers.set("server-timing", "hub;dur=40");
  return response;
};
const auth = {ready:true,authenticated:true,user:{sub:"fixture-user"},hubAuthRequired:true,hubDemo:{available:false},refreshAuth:async()=>{}};
createRoot(document.getElementById("root")).render(<BrowserRouter><FantasyPerformanceListener /><AuthContext.Provider value={auth}><div className="app"><main id="main-content"><DraftHub subView="week" active onSubViewChange={()=>{}} /></main></div></AuthContext.Provider></BrowserRouter>);
