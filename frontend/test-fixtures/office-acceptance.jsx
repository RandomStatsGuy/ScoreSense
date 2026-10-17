// Isolated office production components; no real account, email or league writes.
import React,{useState} from "react";
import {createRoot} from "react-dom/client";
import {BrowserRouter,useNavigate} from "react-router-dom";
import LeagueSheetImport from "../src/DraftHub/LeagueSheetImport";
import LeagueOffice from "../src/DraftHub/LeagueOffice";
import {capabilitiesFromRules} from "../src/DraftHub/leagueCapabilities";
import {DEFAULT_RULES,mergeLeagueRules} from "../src/DraftHub/rulesPresentation";
import "../src/styles.css";
import "../src/styles/fantasy.css";
import "../src/styles/product-hierarchy.css";
import "../src/styles/product-rhythm.css";
import "../src/styles/fantasy-phone.css";
import "../src/styles/standalone-dialogs.css";
import "../src/styles/color-theme.css";
const params=new URLSearchParams(location.search),pane=params.get("pane")||"members";
const qa=window.__office={requests:[],writes:[],reads:[],callbacks:[],holds:params.has("loading")?["/members","/delete-request","/corrections/"]:[],failReads:params.has("read-error")?["/members","/delete-request","/corrections/"]:[],resolve(i,data={},status=200){this.writes[i].resolve(Response.json(data,{status}));},release(i,data,status=200){this.reads[i].resolve(Response.json(data,{status}));}};
const members=id=>({teams:[{id:id+"1",owner_name:id+" Morgan Alexandra Montgomery",name:"Sunday Scaries",user_sub:"primary",is_commissioner:true},{id:id+"2",owner_name:id+" Taylor",name:"Fourth and Long",user_sub:"member"},{id:id+"3",name:id+" Open team"}],commissioner_sub:"primary",hub_context:{lock_team_claims:true},invites:[],resize:{team_count:12,actual_teams:3,add:{ok:true,next_team_count:12,salary_cap:200},removals:[{team_id:id+"2",ok:true,consequences:["League becomes 11 seats."]},{team_id:id+"3",ok:true,consequences:["League becomes 11 seats."]}]}});
const correction=(id,week=1)=>({teams:members(id).teams.slice(0,2),slots:{QB:1,RB:2,WR:2,TE:1,FLEX:1,K:1,DEF:1},slot_positions:{QB:["QB"],RB:["RB"],WR:["WR"],TE:["TE"],FLEX:["RB","WR","TE"],K:["K"],DEF:["DEF"]},revision:id+week,finalized:params.has("finalized"),lineups:[{team_id:id+"1",player_id:"qb",player_name:"Jalen Hurts",position:"QB",nfl_team:"PHI",slot:"BN"},{team_id:id+"2",player_id:"other",player_name:"Josh Allen",position:"QB",nfl_team:"BUF",slot:"QB1"}],current_roster_candidates:{[id+"1"]:[{player_id:"now",player_name:"Justin Jefferson",position:"WR",nfl_team:"MIN"}]},history:[]});
qa.members=members;qa.correction=correction;
window.fetch=async(input,options={})=>{
 const u=new URL(String(input),location.origin),method=options.method||"GET",id=u.pathname.match(/league\/([^/]+)/)?.[1]||"A";
 const body=options.body instanceof FormData?{file:options.body.get("file")?.name}:options.body?JSON.parse(options.body):null;
 const request={url:u.pathname+u.search,method,body};qa.requests.push(request);
 if(method!=="GET"){
  if(!/^\/api\/hub\/(league\/[^/]+\/(franchises|size|teams|invites|settings|sleeper|delete-request|corrections)|cap-sheet\/(validate|import)|league-sheet\/import)/.test(u.pathname))return Response.json({detail:"Unexpected fixture write"},{status:405});
  return new Promise(resolve=>qa.writes.push({...request,resolve}));
 }
 if(qa.holds.some(part=>u.pathname.includes(part)))return new Promise(resolve=>qa.reads.push({...request,resolve}));
 if(qa.failReads.some(part=>u.pathname.includes(part)))return Response.json({detail:"Fixture read unavailable"},{status:503});
 if(u.pathname.endsWith("/members"))return Response.json(members(id));
 if(u.pathname.endsWith("/delete-request"))return Response.json({league_name:id+" Sunday League",pending:false,required_count:2});
 if(u.pathname.endsWith("/export"))return new Response("synthetic workbook",{headers:{"Content-Type":"application/octet-stream"}});
 if(u.pathname.endsWith("/disconnect"))return Response.json({sleeper_roster_rows:3,teams_linked:2});
 if(u.pathname.includes("/corrections/"))return params.has("sleeper")?Response.json({detail:"Scoring is managed on Sleeper"},{status:400}):Response.json(correction(id,Number(u.pathname.split("/").at(-1))));
 if(u.pathname.includes("/suggest"))return Response.json({suggestions:[{player_id:"wr",player_name:"CeeDee Lamb",position:"WR",team:"DAL"}]});
 if(u.pathname.includes("/sleeper/league/"))return Response.json({teams:[{roster_id:1,team_name:"Sleeper one"}],league_name:"Synthetic Sleeper",season:2026});
 return Response.json({detail:"Unexpected fixture read"},{status:404});
};
function App(){
 const [state,setState]=useState({league:"A",staff:!params.has("member"),primary:true,invite:true,readonly:params.has("readonly"),pick:params.has("pick"),linked:params.has("linked"),paused:params.has("paused"),season:2026});
 const navigate=useNavigate();qa.update=patch=>setState(s=>({...s,...patch}));qa.navigate=navigate;
 const rules=mergeLeagueRules({...DEFAULT_RULES,draft_type:state.pick?"snake":"auction"}),ctx={mode:"league",league_id:state.league,league_name:state.league+" Sunday League",season:state.season,is_commissioner:state.staff,is_primary_commissioner:state.primary,can_invite_members:state.invite,readonly:state.readonly,rules,capabilities:capabilitiesFromRules(rules),...(state.linked?{sleeper_league_id:"synthetic-sleeper",sleeper_sync_paused:state.paused}:{})};
 return <main id="main-content" className="draft-hub">{pane === "csv-standalone" ? <LeagueSheetImport leagueId={state.league} season={state.season} onImported={()=>qa.callbacks.push(state.league)} /> : <LeagueOffice leagueId={state.league} hubContext={ctx} workspace={{season:state.season,rules}} officeTab={pane} onChanged={()=>qa.callbacks.push(state.league)} onNavigate={target=>qa.callbacks.push(target)}/>}</main>;
}
createRoot(document.getElementById("root")).render(<BrowserRouter><App/></BrowserRouter>);
