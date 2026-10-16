import {DEFAULT_RULES} from "../src/DraftHub/rulesPresentation.js";
import homeBanner from "../../docs/mockups/trade-banner-images/stadium.svg";
import awayBanner from "../../docs/mockups/trade-banner-images/city.svg";
const fixtureFetch = window.fetch.bind(window);
const params = new URLSearchParams(location.search);
const state = params.get("state") || "pregame";
if(params.has("palette"))document.documentElement.dataset.experienceTheme=params.get("palette");
const salary = params.get("format") !== "pick";
const staff = params.get("role") !== "member";
const pre = state === "pre";
const native = params.get("host") === "native";
const projected = ["pregame", "missing"].includes(state);
if (params.get("theme") === "light") document.documentElement.dataset.theme = "light";
export const context = { league_name:"Bottom to Top", season:2026, team_name:"Sunday Service", rules:DEFAULT_RULES, capabilities:{uses_salaries:salary,uses_contracts:salary}, mode: "league", league_id: "home-fixture", team_id: "mine", draft_completed: !pre, is_commissioner: staff, is_primary_commissioner: staff, sleeper_league_id: native ? null : "fixture-sleeper" };
const standings = [
  { roster_id: "1", hub_team_id: "mine", owner_name: "Caleb K", team_name: "Sunday Service", wins: 4, losses: 1, rank: 1, points_for: 653.2 },
  { roster_id: "2", hub_team_id: "other", owner_name: "Jordan D", team_name: "Ragdollin With Mahomies", wins: 3, losses: 2, rank: 2, points_for: 632.8 },
  { roster_id: "3", hub_team_id: "third", owner_name: "Sam M", team_name: "Sunday Squad", wins: 3, losses: 2, rank: 3, points_for: 610.4 },
  { roster_id: "4", hub_team_id: "fourth", owner_name: "Morgan T", team_name: "Goal Line", wins: 3, losses: 2, rank: 4, points_for: 598.1 },
  { roster_id: "5", hub_team_id: "fifth", owner_name: "Jamie P", team_name: "Fourth & Long", wins: 2, losses: 3, rank: 5, points_for: state === "missing" ? null : 575.6 },
  { roster_id: "6", hub_team_id: "sixth", owner_name: "Alex R", team_name: "End Zone", wins: 2, losses: 3, rank: 6, points_for: 570.2 },
];
if(params.has('long')) {
 standings[0].owner_name='Caleb Kensington-Sutherland';standings[0].team_name='The Sunday Service Fantasy Football Collective';
 standings[1].owner_name='Jordan Davis-Washington';standings[1].team_name='Ragdollin With Mahomies All Season Long';
}
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
window.fixtureScoreControl = {fail:false, slowWeek:null, pending:params.has("pending")};
window.fixtureRequests = []; window.fixtureWrites = []; window.fixtureActions = [];
window.fetch = async (input, options={}) => {
  if(String(input).includes('/api/hub/media/'))return new Response(await(await fixtureFetch(String(input).includes('sample-home')?homeBanner:awayBanner)).text(),{headers:{'Content-Type':'image/svg+xml'}});
  if(String(input).includes('/identities'))return Response.json({identities:params.get('art')==='none'?{}:{mine:{banner_media_id:'sample-home',banner_focus:{x:35,y:60,zoom:1.2}},other:{banner_media_id:'sample-away',banner_focus:{x:65,y:50,zoom:1}}}});
  const path=String(input); window.fixtureRequests.push(path);
  if(options.method && options.method !== "GET")window.fixtureWrites.push({path,method:options.method,body:options.body});
  if(path==='/api/hub/context')return Response.json(context);
  if(path.startsWith('/api/hub/workspace'))return Response.json({hub_context:context,season:2026,rules:DEFAULT_RULES,roster:[],draft_log:[],league:context});
  if(path.startsWith('/api/hub/memberships'))return Response.json({memberships:[{league_id:context.league_id,league_name:context.league_name,team:{id:'mine',name:context.team_name}}]});
  if(path==='/api/hub/prefs')return Response.json({theme:'dark',appearance:{}});
  if(path.includes('/freshness'))return Response.json({sleeper:{linked:!native},projections:{available:true}});
  if(path.includes('/api/hub/home')) {
    if(state === "loading")await new Promise(resolve=>setTimeout(resolve,15000));
    if(state === "error")return Response.json({detail:"Home unavailable"},{status:503});
    return Response.json(home);
  }
  if(path.includes('live-scoring')) {
    const selectedWeek = Number(new URL(path,location.origin).searchParams.get('week') || 6);
    if (window.fixtureScoreControl.slowWeek === selectedWeek) await new Promise(resolve => {window.fixtureResolveWeek=resolve;});
    if(window.fixtureScoreControl.fail)return Response.json({detail:"Refresh unavailable"},{status:503});
    if(state === "scoring-error" && !window.fixtureScoreControl.recovered)return Response.json({detail:"Scoring unavailable"},{status:503});
    return Response.json({available:true, home_display_mode:projected ? "projected" : "scores", season:2026, week:selectedWeek, max_week:18, current_week:6, synced_at:new Date().toISOString(), week_complete:state === "final", live:gameState === "live", placeholder:pre || (native && projected), source:native ? "hub" : "sleeper", reason:native && projected ? "hub_unscored" : undefined, viewer_matchup_id:"1", standings:pre || state === "empty" ? [] : standings,
      scoring_control:{host:native ? "native" : "sleeper",scored:!projected,final:state==="final",live:gameState==="live",refresh:{status:window.fixtureScoreControl.pending?"pending":"idle"}}, recent_activity:[{event_type:"add",player_name:"Wan’Dale Robinson",to_owner:"Sam M",event_at:new Date().toISOString()}],
      matchups:pre || state === "empty" ? [] : [{matchup_id:"1",teams}, ...[2,4].map((offset,i)=>({matchup_id:String(i+2),teams:standings.slice(offset,offset+2).map((team,j)=>({...team,points:gameState==='live'?12+i+j:0,proj_total:100+i+j,starters:[{player_id:`other${i}${j}`,name:'Starter',proj:100+i+j,game_state:gameState}]}))}))]});
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
