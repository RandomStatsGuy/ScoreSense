// Production Vibes; every HTTP response and write is isolated synthetic data.
import React, {useState} from "react";
import {createRoot} from "react-dom/client";
import {BrowserRouter} from "react-router-dom";
import VibeRankings from "../src/DraftHub/VibeRankings";
import {CommunicationProvider} from "../src/DraftHub/CommunicationContext";
import ChatLauncher from "../src/DraftHub/ChatLauncher";
import CommunicationPanel from "../src/DraftHub/CommunicationPanel";
import "../src/styles.css";
import "../src/styles/fantasy.css";
import "../src/styles/product-hierarchy.css";
import "../src/styles/product-rhythm.css";
import "../src/styles/fantasy-phone.css";
import "../src/styles/color-theme.css";
import "../src/styles/fantasy-chat.css";
import "../src/styles/standalone-dialogs.css";
const params=new URLSearchParams(location.search);
const qa=window.__vibes={requests:[],unexpected:[],pending:[],holds:[],failures:[],nav:[],focused:params.get("focus")||"A",remote:{A:{},B:{}},resolve(i,data,status=200){this.pending[i].resolve(Response.json(data,{status}));}};
if(params.has("fail"))qa.failures.push(params.get("fail"));
if(params.has("hold"))qa.holds.push({match:params.get("hold"),method:"GET"});
const matches=(rule,r)=>typeof rule==="string"?r.path.includes(rule):r.path.includes(rule.match)&&(!rule.method||r.method===rule.method);
function week(id,state=qa.state){
 const rows=[{player_id:"p1",player_name:id+" Jordan Alexander Montgomery",position:"QB",p50:24,p10:16,p90:32,slot:"QB"},{player_id:"p2",player_name:id+" Bijan Robinson",position:"RB",p50:18,p10:10,p90:25,slot:"RB",on_bye:state.bye},{player_id:"p3",player_name:id+" Justin Jefferson",position:"WR",p50:state.missing?null:16,p10:9,p90:23,slot:"WR"},{player_id:"p4",player_name:id+" Brock Bowers",position:"TE",p50:12,p10:6,p90:18,slot:"TE"},{player_id:"p5",player_name:id+" Zero Forecast",position:"WR",p50:0,p10:0,p90:0}].map(p=>({...p,team:"",opponent:"",lineup_role:p.slot?"starter":"bench"}));
 return {hub_context:{...qa.context,league_id:id,team_id:id+"-team"},meta:{season:state.season,week:state.week,lineup_source:state.host==="sleeper"?"sleeper":"hub",lineup_locked:state.locked,week_scored:state.scored},roster:{starters:state.empty?[]:rows.slice(0,4),bench:state.empty?[]:rows.slice(4)}};
}
qa.week=week;
window.fetch=async(input,opts={})=>{
 const u=new URL(String(input),location.origin),r={path:u.pathname,url:u.pathname+u.search,method:opts.method||"GET",body:opts.body?JSON.parse(opts.body):null};qa.requests.push(r);
 if(qa.holds.some(rule=>matches(rule,r)))return new Promise(resolve=>qa.pending.push({...r,resolve}));
 if(qa.failures.some(rule=>matches(rule,r)))return Response.json({detail:"Sample request unavailable"},{status:503});
 let data;const id=u.searchParams.get("league_id")||qa.focused;
 if(r.path==="/api/hub/week")data=week(id);
 else if(r.path==="/api/hub/vibes"){if(r.method==="PUT")qa.remote[id]={...r.body.aura_by_id};data={aura_by_id:qa.remote[id]};}
 else if(r.path.endsWith("/lineup")&&r.method==="PUT")data={ok:true};
 else if(r.path==="/api/lineup/vegas")data={teams:{}};
 else if(r.path==="/api/players/media")data={media:{}};
 else if(r.path.endsWith("/chat/summary"))data={members:[],threads:[],notifications:[],unread:0,notification_unread:0,preferences:{}};
 else if(r.path.includes("/chat/thread/"))data={messages:[]};
 else if(r.path.endsWith("/latest"))data={latest:{headline:"Sample workload update",detail:"Saved sample practice context.",source:"Sample report"}};
 if(data===undefined){qa.unexpected.push(r);return Response.json({detail:"Unexpected fixture request"},{status:404});}
 return Response.json(data);
};
function Fixture(){const [state,setState]=useState({league:"A",identity:"sample-user",season:2026,week:8,host:params.get("host")||"native",readonly:params.has("readonly"),locked:params.has("locked"),scored:false,empty:params.has("empty"),missing:params.has("missing"),bye:params.has("bye"),solo:params.has("solo"),reload:0,mounted:true});qa.state=state;qa.update=patch=>setState(s=>({...s,...patch}));
 const ctx={mode:state.solo?"solo":"league",league_id:state.league,team_id:state.league+"-team",league_name:"Sample league "+state.league,season:state.season,is_commissioner:true,readonly:state.readonly,draft_completed:true,sleeper_league_id:state.host==="sleeper"?"linked":null,rules:{roster:{qb:{starter:1},rb:{starter:1},wr:{starter:1},te:{starter:1},flex:{starter:1},k:{starter:1},def:{starter:1}}}};qa.context=ctx;
 return <CommunicationProvider enabled={!state.solo} hubContext={ctx} identity={state.identity}><a href="#main-content" className="app-skip-link">Skip to content</a><main id="main-content" className="app"><div className="draft-hub">{state.mounted&&<VibeRankings hubContext={ctx} cacheScope={state.identity} reloadToken={state.reload} onNavigate={(...args)=>qa.nav.push(args)}/>}</div></main><ChatLauncher leagueId={state.league}/><CommunicationPanel/></CommunicationProvider>;
}
createRoot(document.getElementById("root")).render(<BrowserRouter><Fixture/></BrowserRouter>);
