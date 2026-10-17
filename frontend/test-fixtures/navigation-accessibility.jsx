// Current App with synthetic HTTP: read-only by default; opt-in shell cases acknowledge focus writes.
import React, { useEffect, useState } from "react";
import ContractPlayerJourney from "../src/DraftHub/ContractPlayerJourney";
import LeagueContractHistory from "../src/DraftHub/LeagueContractHistory";
import CapSheetImport from "../src/DraftHub/CapSheetImport";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "../src/App";
import { capabilitiesFromRules } from "../src/DraftHub/leagueCapabilities";
import { AuthContext } from "../src/AuthContext";
import { AppearanceProvider } from "../src/AppearanceProvider";
import "../src/styles.css";
import "../src/styles/product-hierarchy.css";
import "../src/styles/product-rhythm.css";
import "../src/styles/projections-experience.css";
import "../src/styles/fantasy-phone.css";
import "../src/styles/fantasy-header.css";
import "../src/styles/color-theme.css";
import "../src/styles/fantasy-chat.css";
import "../src/styles/appearance.css";
const fixtureParams=new URLSearchParams(location.search);
const preseasonScenario=(fixtureParams.get("fixtureMeta")|| (location.pathname.endsWith("/preseason")?"preseason":"live"))==="preseason";
const rules={draft_type:"auction",salary_cap:200,roster_size_max:12,roster:{qb:{starter:1},rb:{starter:0},wr:{starter:0},te:{starter:0},k:{starter:0},def:{starter:0},flex:{starter:0}}};
let context={mode:"league",league_id:"navigation-fixture",league_name:"Synthetic long league name for navigation testing",team_id:"mine",team_name:"Example team",season:2026,is_commissioner:true,draft_completed:true,rules,capabilities:capabilitiesFromRules(rules)};
const row={player_id:"example-qb",Player:"Example quarterback",Team:"BUF",Position:"QB",Season:2026,Week:6,Age:30,"Projected Points":22.4,"Low (P10)":10,"High (P90)":32,"Season Proj":350,"Per-Game Proj":22.4,"Low (Season)":200,"High (Season)":450,P50:22.4,"ROS P50":220,"ROS Proj":220,model_rank:1,adp_rank:2,value_vs_adp:1};
const starter={player_id:row.player_id,player_name:row.Player,position:"QB",team:"BUF",slot:"QB",p50:22.4,p10:10,p90:32};
const fixture=window.__navigationFixture={requests:[],metadataMode:preseasonScenario?"preseason":"live",metadataPending:0,metadataResolved:0};
// Opt-in full-App account/focus races; the regular navigation fixture stays read-only.
const shellMode=fixtureParams.has("fixtureShell");
const firstContext={...context};
const secondContext={...context,league_id:"pick-fixture",league_name:"Example pick league",is_commissioner:false,rules:{...rules,draft_type:"snake",salary_cap:null},capabilities:capabilitiesFromRules({draft_type:"snake"})};
const otherContext={...context,league_id:"other-account-fixture",league_name:"Other account league",team_id:"other-team",is_commissioner:false};
let identity="navigation-user", nextWorkspaceHold=false, nextFocusHold=false;
const workspaceWaiters=[],focusWaiters=[];
Object.assign(fixture,{
  failFocus:false,failWorkspace:false,workspacePending:0,focusPending:0,
  holdWorkspace(){nextWorkspaceHold=true;},
  releaseWorkspace(){workspaceWaiters.splice(0).forEach(resolve=>resolve());},
  holdFocus(){nextFocusHold=true;},
  releaseFocus(){focusWaiters.splice(0).forEach(resolve=>resolve());},
});
const memberships=()=>[firstContext,secondContext].map(ctx=>({league_id:ctx.league_id,league_name:ctx.league_name,team:{id:ctx.team_id,name:ctx.team_name},is_commissioner:ctx.is_commissioner}));
window.fetch=async(input,options={})=>{
  const path=String(input),method=options.method||"GET";
  fixture.requests.push({path,method,identity,body:options.body});
  if(shellMode&&path.includes("/api/hub/active-league")&&method==="PUT"){
    const target=JSON.parse(options.body).league_id;
    const reply=target===secondContext.league_id?secondContext:firstContext;
    const owner=identity;
    if(nextFocusHold){nextFocusHold=false;fixture.focusPending++;await new Promise(resolve=>focusWaiters.push(resolve));fixture.focusPending--;}
    if(fixture.failFocus)return Response.json({detail:"Example focus failure"},{status:503});
    if(identity===owner)context=reply;
    return Response.json({hub_context:reply});
  }
  if(shellMode&&method==="GET"&&path.includes("/api/hub/workspace")){
    const fail=fixture.failWorkspace;
    const captured={season:2026,rules:context.rules,hub_context:context,memberships:identity==="navigation-user"?memberships():[],prefs:{}};
    if(nextWorkspaceHold){nextWorkspaceHold=false;fixture.workspacePending++;await new Promise(resolve=>workspaceWaiters.push(resolve));fixture.workspacePending--;}
    if(fail)return Response.json({detail:"Example workspace failure"},{status:503});
    return Response.json(captured);
  }
  if(!["GET","HEAD"].includes(method))return Response.json({detail:"Navigation fixtures reject writes."},{status:405});
  if(path.includes("/chat/summary"))return Response.json({threads:[],members:[],notifications:[],unread:0,notification_unread:0,preferences:{}});
  if(path.includes("/contract-history/player-journey"))return Response.json({player_name:"Example player with an exceptionally long name for wrapped headers",seasons:Array.from({length:9},(_,i)=>({season_year:2026-i,row_id:i+1,cap_hit:12,hub_team_name:"Example team",roster_status:"active",is_editing_season:i===0}))});
  if(path.includes("/contract-history"))return Response.json({season_year:2026,seasons:[2026],rows:[],row_issues:{},owner_season_map:[]});
  if(path.includes("/card"))return Response.json({player_id:row.player_id,player_name:row.Player,position:row.Position,team:row.Team,weekly_projection:{"Projected Points":22.4,"Low (P10)":10,"High (P90)":32},rest_of_season_projection:{p10:180,p50:220,p90:280,games_remaining:10},game_log:[],meta:{season:2026,week:6}});
  if(path.includes("/api/hub/context"))return Response.json(context);
  if(path.includes("/api/hub/workspace"))return Response.json({season:2026,rules,hub_context:context,memberships:[{league_id:context.league_id,league_name:context.league_name,team:{id:"mine",name:"Example team"},is_commissioner:true}],prefs:{}});
  if(path.includes("/api/hub/week"))return Response.json({hub_context:context,meta:{season:2026,week:6,lineup_source:"hub",week_scored:false},status:{},sync:{},counts:{roster:1,missing_projections:0},decisions:[],roster:{starters:[starter],bench:[]}});
  if(path.includes("/live-scoring"))return Response.json({available:true,source:"hub",placeholder:true,season:2026,week:6,current_week:6,max_week:18,starting_slots:["QB"],standings:[],scoring_control:{host:"native",final:false},matchups:[]});
  if(path.includes("/api/refresh/status"))return Response.json({status:"never_run",automatic:{last_success_at:"2026-10-17T00:00:00Z",health:{}}});
  if(path.includes("/api/meta/")){
    fixture.metadataPending++;
    await new Promise(resolve=>setTimeout(resolve,Number(fixtureParams.get("fixtureMetaDelay"))||0));
    fixture.metadataPending--;fixture.metadataResolved++;
    return Response.json({default_season:2026,default_week:6,upcoming_season:2026,seasons:[2026],teams:["BUF"],weeks_by_season:{"2026":[6]},is_offseason:fixture.metadataMode==="preseason",preseason_mode:fixture.metadataMode==="preseason"});
  }
  if(path.includes("/api/predict/")&&path.includes("changes"))return Response.json({changes:[]});
  if(path.includes("/api/predict/")||path.includes("/api/draft/")||path.includes("/api/ros/"))return Response.json({position:"qb",projections:[row],meta:{season:2026,week:6,from_week:6,projection_week:6,weeks_remaining:10,projection_built_at:"2026-10-17T00:00:00Z",projection_refresh:{needs_attention:false}}});
  if(path.includes("/api/bestball/board"))return Response.json({players:[row],meta:{with_adp:1}});
  if(path.includes("/api/hub/mock-drafts"))return Response.json({rooms:[]});
  if(path.includes("preferences"))return Response.json({preferences:{}});
  return Response.json({players:[],projections:[],media:{},teams:[],memberships:[],presets:[],rows:[],aura_by_player_id:{}});
};
const auth={ready:true,authenticated:true,user:{sub:"navigation-user",name:"Example manager",email_verified:true,is_admin:true},hubAuthRequired:false,authRequired:false,isAdmin:true,hubDemo:{available:false},openSignIn:()=>{},closeSignIn:()=>{},logout:()=>{},refreshAuth:async()=>{}};
function ConsumerPreview({consumer}){
  const [open,setOpen]=useState(false);
  return <div className="app"><main id="main-content"><h1>Shared sheet consumer</h1>
    {consumer==="journey"?<><button className="btn btn-ghost" onClick={()=>setOpen(true)}>Open contract journey</button>{open&&<ContractPlayerJourney leagueId={context.league_id} playerName="Example player with an exceptionally long name for wrapped headers" editingSeason="2026" onEditRow={()=>{}} onClose={()=>setOpen(false)}/>}</>:consumer==="history"?<LeagueContractHistory leagueId={context.league_id} hubContext={context} seasonFilter="2026"/>:<CapSheetImport/>}
  </main></div>;
}
function AuthHarness({children}){
  const [current,setCurrent]=useState(auth);
  useEffect(()=>{fixture.renderedIdentity=current.user?.sub||"signed-out";},[current]);
  fixture.setIdentity=(next)=>{
    identity=next;context=next==="navigation-user"?firstContext:otherContext;
    setCurrent({...auth,authenticated:next!=="signed-out",hubAuthRequired:next==="signed-out",user:next==="signed-out"?null:{...auth.user,sub:next}});
  };
  return <AuthContext.Provider value={current}>{children}</AuthContext.Provider>;
}
const consumer=new URLSearchParams(location.search).get("consumer");
createRoot(document.getElementById("root")).render(<BrowserRouter><AuthHarness><AppearanceProvider>{consumer?<ConsumerPreview consumer={consumer}/>:<App/>}</AppearanceProvider></AuthHarness></BrowserRouter>);
