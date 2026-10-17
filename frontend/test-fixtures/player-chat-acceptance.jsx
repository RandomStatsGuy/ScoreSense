// Production player/chat components. All HTTP and message writes are synthetic.
import React,{useMemo,useState} from "react";
import {createRoot} from "react-dom/client";
import {BrowserRouter,useLocation} from "react-router-dom";
import PlayerCardModal from "../src/PlayerCardModal";
import PlayerContextPanel from "../src/PlayerContextPanel";
import {CommunicationProvider,useCommunication} from "../src/DraftHub/CommunicationContext";
import ChatThread from "../src/DraftHub/ChatThread";
import ChatLauncher from "../src/DraftHub/ChatLauncher";
import CommunicationPanel,{NotificationBell,NotificationSettingsAction} from "../src/DraftHub/CommunicationPanel";
import "../src/styles.css";
import "../src/styles/fantasy.css";
import "../src/styles/projections-experience.css";
import "../src/styles/product-hierarchy.css";
import "../src/styles/product-rhythm.css";
import "../src/styles/fantasy-phone.css";
import "../src/styles/color-theme.css";
import "../src/styles/fantasy-chat.css";
import "../src/styles/standalone-dialogs.css";
const params=new URLSearchParams(location.search);
const names={A:"Josh Allen",B:"Lamar Jackson"};
const qa=window.__pc={requests:[],pending:[],jsonPending:[],holds:[],jsonHolds:[],failures:[],overrides:[],unexpected:[],actions:[],prefs:{trade:true,direct:true,mention:true,league:false},resolve(i,data,status=200){this.pending[i].resolve(Response.json(data,{status}));},resolveJson(i,data){this.jsonPending[i].resolve(data);},matches(rule,r){return typeof rule==="string"?r.url.includes(rule):r.url.includes(rule.match)&&(!rule.method||r.method===rule.method);}};
if(params.has("fail"))qa.failures.push(...params.get("fail").split(","));if(params.has("jsonhold"))qa.jsonHolds.push(params.get("jsonhold"));
function card(id,state=qa.state){const values=[0,18,24,16,22,20,14],points=values.reduce((a,b)=>a+b,0);return {player_id:id,player_name:names[id],team:"",position:"qb",weekly_projection:{"Projected Points":24.8,"Low (P10)":17.2,"High (P90)":33.4,...(state.bye?{is_bye:true}:{})},rest_of_season_projection:state.missing?null:{p10:130,p50:180,p90:230,games_remaining:10},preseason_projection:{p10:280,p50:340,p90:400},preseason_baseline:state.missing?null:{points:340,games:17},season_to_date:{points:state.missing?null:points,ppg:state.missing?null:points/7,games_played:state.missing?null:7,through_week:7,complete:!state.missing},game_log:state.missing?[]:values.map((points,i)=>({week:7-i,opponent:"NE",is_home:i%2===0,points,passing_yards:200+i*10,rushing_yards:30,receptions:0,receiving_yards:0,touchdowns:2})),game_log_season:state.season,injury:state.injury?{injury_status:"Questionable",injury_body_part:"Ankle",injury_notes:"Sample practice limitation"}:null,meta:{season:state.season,week:state.week,preseason_mode:state.preseason,built_at:"2026-10-17T17:00:00Z"}};}
function note(id){return {player_id:id,this_week:{headline:names[id]+" practice report",detail:"Sample locker report about workload.",source:"Sample practice report"},media_context:{state:"none"},meta:{season:qa.state.season,week:qa.state.week}};}
function summary(id){return {threads:[],members:[{id:"1",name:id+" Morgan Alexandra Montgomery",team_name:"Fourth and Forever",is_staff:true,can_message:true},{id:"2",name:id+" Taylor Reed",team_name:"Sunday Rivals",is_staff:false,can_message:qa.state.partnerAllowed}],notifications:[{id:id+"alert",kind:"trade",title:id+" Trade response",body:"Sample response",created_at:"2026-10-17T18:00:00Z",target:{view:"trades"}}],preferences:{...qa.prefs},unread:2,notification_unread:1};}
function message(id,thread="league",body){return {id:id+thread+"m1",team_id:"2",owner_name:id+" Taylor Reed",body:body||`${id} ${thread} message`,created_at:"2026-10-17T18:00:00Z",reactions:[{emoji:"👍",count:1,mine:false}]};}
qa.card=card;qa.note=note;qa.summary=summary;qa.message=message;
window.fetch=async(input,opts={})=>{const u=new URL(String(input),location.origin),r={url:u.pathname+u.search,method:opts.method||"GET",body:opts.body?JSON.parse(opts.body):undefined};qa.requests.push(r);
 if(qa.holds.some(rule=>qa.matches(rule,r)))return new Promise(resolve=>qa.pending.push({...r,resolve}));
 if(qa.failures.some(rule=>qa.matches(rule,r)))return Response.json({detail:"Fixture request failed"},{status:503});
 const override=qa.overrides.find(rule=>qa.matches(rule,r));if(override)return Response.json(override.data,{status:override.status||200});
 let data;const player=u.pathname.match(/^\/api\/player\/([^/]+)\/(card|context|latest|explanation)$/),league=u.pathname.match(/^\/api\/hub\/league\/([^/]+)\/(.+)$/);
 if(player){const [,id,type]=player;data=type==="card"?card(id):type==="explanation"?{projection_signals:[{id:"usage",label:"Expected passing volume",detail:"Sample saved usage signal",direction:"up"}]}:note(id);}
 else if(u.pathname==="/api/accuracy")data={summary:{scoresense_avg_mae:4.2}};
 else if(u.pathname==="/api/players/media")data={media:{}};
 else if(u.pathname==="/api/hub/notifications/preferences"){if(r.method==="PUT")qa.prefs={...qa.prefs,...r.body.preferences};data={preferences:{...qa.prefs}};}
 else if(league){const [,id,path]=league;if(path==="chat/summary")data=summary(id);else if(path.startsWith("chat/thread/")){const thread=decodeURIComponent(path.slice(12));data=r.method==="POST"?{message:{...message(id,thread,r.body.body),id:"sent"+qa.requests.length,team_id:"1",mentions:summary(id).members.filter(m=>r.body.mentions?.includes(m.id))}}:{messages:[message(id,thread)]};}else if(path.endsWith("/reactions"))data={message:{...message(id),reactions:[{emoji:r.body.emoji,count:r.body.pressed?2:1,mine:r.body.pressed}]}};else if(path==="chat/read"||path==="notifications/read"||r.method==="DELETE")data={ok:true};}
 if(data===undefined){qa.unexpected.push(r);return Response.json({detail:"Unexpected fixture request"},{status:404});}
 const res=Response.json(data);if(qa.jsonHolds.some(rule=>qa.matches(rule,r)))res.json=()=>new Promise(resolve=>qa.jsonPending.push({...r,resolve}));return res;
};
function Bridge(){qa.api=useCommunication();qa.path=useLocation().pathname;return null;}
function App(){const [state,setState]=useState({view:params.get("view")||"player",pid:"A",season:2026,week:8,open:false,staff:!params.has("member"),primary:!params.has("member"),readonly:params.has("readonly"),league:"A",identity:"one",team:"1",partnerAllowed:true,bye:params.has("bye"),missing:params.has("missing"),preseason:params.has("preseason"),injury:params.has("injury"),enabled:true});qa.state=state;qa.update=patch=>setState(s=>({...s,...patch}));
 const ctx={mode:"league",league_id:state.league,league_name:state.league+" Sunday Football Collective",team_id:state.team,is_commissioner:state.staff,is_primary_commissioner:state.primary,readonly:state.readonly};
 const request=useMemo(()=>({playerId:state.pid,playerName:names[state.pid],season:state.season,week:state.week,position:"qb",scope:"weekly",team:""}),[state.pid,state.season,state.week]);
 const [compare,setCompare]=useState([]);qa.compare=compare;
 if(state.view==="player"||state.view==="notes")return <><a className="app-skip-link" href="#main-content">Skip to content</a><main id="main-content" className="app"><h1>Player details</h1><button type="button" className="btn-ghost" onClick={()=>setState(s=>({...s,open:true}))}>Open player details</button>{state.view==="notes"&&<PlayerContextPanel playerId={state.pid} season={state.season} week={state.week} variant="notes"/>}</main>{state.open&&<PlayerCardModal request={request} onClose={()=>setState(s=>({...s,open:false}))} candidates={Object.entries(names).map(([playerId,name])=>({playerId,name,position:"qb",team:""}))} onSelectPlayer={hit=>setState(s=>({...s,pid:hit.playerId}))} compareIds={compare} onToggleCompare={row=>{qa.actions.push(row);setCompare(prev=>prev.includes(row.player_id)?prev.filter(id=>id!==row.player_id):[...prev,row.player_id]);}}/>}</>;
 return <CommunicationProvider enabled={state.enabled} hubContext={ctx} identity={state.identity}><Bridge/><a className="app-skip-link" href="#main-content">Skip to content</a><main id="main-content" className="app"><div className="draft-hub"><h1>League conversation</h1><NotificationBell/><NotificationSettingsAction className="btn-ghost"/>{state.view==="chat"||state.view==="compact"?<div style={{maxWidth:"40rem",margin:"auto"}}><ChatThread leagueId={state.league} hubContext={ctx} compact={state.view==="compact"}/></div>:null}</div></main><ChatLauncher leagueId={state.league} hidden={state.view==="chat"||state.view==="compact"}/><CommunicationPanel/></CommunicationProvider>;
}
createRoot(document.getElementById("root")).render(<BrowserRouter><App/></BrowserRouter>);
