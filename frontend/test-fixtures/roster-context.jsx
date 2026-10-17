// Three current production surfaces; API reads and queued roster writes are synthetic.
import React,{useState} from "react";
import {createRoot} from "react-dom/client";
import {BrowserRouter} from "react-router-dom";
import CapPlanner from "../src/DraftHub/CapPlanner";
import RosterBuilder from "../src/DraftHub/RosterBuilder";
import LeagueRostersBrowser from "../src/DraftHub/LeagueRostersBrowser";
import {TeamIdentityProvider} from "../src/DraftHub/TeamIdentityContext";
import {capabilitiesFromRules} from "../src/DraftHub/leagueCapabilities";
import capData from "./cap-planner-data.json";
import "../src/styles.css";
import "../src/styles/fantasy.css";
import "../src/styles/product-hierarchy.css";
import "../src/styles/product-rhythm.css";
import "../src/styles/fantasy-phone.css";
import "../src/styles/color-theme.css";
const params=new URLSearchParams(location.search),surface=params.get("surface")||"cap",format=params.get("format")||"auction";
const rules={...capData.rules,draft_type:format};
const fixture=window.__rosterFixture={requests:[],writes:[],callbacks:[],navigations:[],reads:[],failReads:false,delayReads:false,readonly:params.has("readonly"),focus:"A",team:"mine",surface};
const leagues=Object.fromEntries(["A","B"].map(id=>{
  const teams=structuredClone(capData.teams).map((t,index)=>{
    t.team={...t.team,name:`${id} ${index?"Rivals":"Owners"}`,owner_name:`${id} manager ${index+1}`};
    t.cap_sheet.planning_rows=t.cap_sheet.planning_rows.map((r,i)=>({...r,id:(id==="A"?100:200)+index*20+i+1,player_name:`${id} ${r.player_name}`}));
    return t;
  });
  return [id,teams];
}));
fixture.leagues=leagues;
const rosterFor=(id,team)=>leagues[id].find(t=>t.team.id===team).cap_sheet.planning_rows;
window.fetch=async(input,options={})=>{
  const url=String(input),method=options.method||"GET",request={url,method,league:fixture.focus,team:fixture.team};fixture.requests.push(request);
  if(!["GET","HEAD"].includes(method)){
    if(!((["PATCH","DELETE"].includes(method)&&url==="/api/hub/roster")||(method==="POST"&&url==="/api/hub/contract/rookie-extend")))return Response.json({detail:"Unexpected fixture write blocked"},{status:405});
    request.body=JSON.parse(options.body||"{}");
    return new Promise(resolve=>fixture.writes.push({...request,resolve:({ok=true}={})=>resolve(ok?Response.json(url.includes("rookie-extend")?{pending_extension:true,extension_years:request.body.extension_years,start_salary:23}:{saved:true}):Response.json({detail:"Synthetic roster save failed"},{status:503}))}));
  }
  if(url.includes("identities"))return Response.json({identities:{}});
  const id=url.match(/\/league\/([AB])\//)?.[1]||fixture.focus;
  if(url.includes("cap-plans")||url.includes("/rosters")){
    const payload=url.includes("cap-plans")?{teams:leagues[id]}:{teams:leagues[id].map(t=>({team:t.team,roster:t.cap_sheet.planning_rows.map((r,i)=>({...r,years_remaining:r.contract_years,contract_type:r.contract?.contract_type,fair_value:i===0?null:r.salary+3,value_delta:i===0?null:-3})),stats:{...t.cap_sheet.summary,committed:t.cap_sheet.summary.spent,unspent:t.cap_sheet.summary.remaining},cap_sheet:t.cap_sheet}))};
    if(fixture.delayReads)return new Promise(resolve=>fixture.reads.push({id,resolve:()=>resolve(Response.json(payload))}));
    return fixture.failReads?Response.json({detail:"Synthetic read failed"},{status:503}):Response.json(payload);
  }
  if(url.includes("season-scores"))return Response.json({available:true,players:{}});
  if(url.endsWith("/room")){
    const team=url.match(/\/teams\/([^/]+)\/room/)?.[1]||"mine",rows=rosterFor(id,team);
    const players=rows.filter(r=>r.is_active).map((r,i)=>({player_id:r.player_id,name:r.player_name,position:r.position,slot:r.position,team:r.team,projection:params.has("missing")&&i===0?null:i===0?20:i===1?15:30,points:null,can_manage:true,lineup_locked:params.has("locked")&&i===5,kickoff_available:true,preview_slots:params.has("locked")&&i===5?[]:r.position==="RB"?[1]:r.position==="QB"?[0]:[]}));
    return Response.json({team:leagues[id].find(t=>t.team.id===team).team,season:2026,week:6,current_week:6,max_week:18,state:"pregame",theme:"none",lineup_host:params.get("host")==="sleeper"?"sleeper":"scoresense",can_edit:!fixture.readonly&&team==="mine",starters:players.slice(0,2),bench:players.slice(2),teams:leagues[id].map(t=>t.team),media:{}});
  }
  return Response.json({media:{},media_by_player_id:{},players:[],teams:[],rows:[],notifications:[]});
};
function Harness(){
  const [scope,setScope]=useState({league:"A",team:"mine"}),[view,setView]=useState(surface),[revision,setRevision]=useState(0);
  fixture.switchScope=(league,team="mine")=>{fixture.focus=league;fixture.team=team;setScope({league,team});};
  fixture.setReadonly=value=>{fixture.readonly=value;setRevision(n=>n+1);};
  fixture.navigate=next=>{setView(next);fixture.surface=next;};
  const team=leagues[scope.league].find(t=>t.team.id===scope.team),rows=rosterFor(scope.league,scope.team);
  const context={mode:"league",league_id:scope.league,league_name:`Example league ${scope.league}`,team_id:scope.team,team_name:team.team.name,owner_name:team.team.owner_name,season:2026,is_commissioner:params.has("staff"),readonly:fixture.readonly,draft_completed:!params.has("pre"),rules,capabilities:capabilitiesFromRules(rules),...(params.get("host")==="sleeper"?{sleeper_league_id:"synthetic"}:{})};
  const onChanged=()=>{fixture.callbacks.push({league:scope.league,team:scope.team});setRevision(n=>n+1);};
  const navigate=(destination,extra)=>fixture.navigations.push({destination,extra,league:scope.league,team:scope.team});
  return <div className="app"><main id="main-content"><div className="draft-hub"><TeamIdentityProvider leagueId={scope.league}>
    {view==="cap"?<CapPlanner capSheet={team.cap_sheet} roster={rows} workspace={{id:"workspace",season:2026,rules}} hubContext={context} onChanged={onChanged} onNavigate={navigate}/>:view==="rosters"?<LeagueRostersBrowser leagueId={scope.league} cacheScope="roster-acceptance" hubContext={context} onNavigateTrade={()=>navigate("trades")} onOpenContractHistory={p=>navigate("history",p)}/>:<RosterBuilder cacheScope="roster-acceptance" roster={rows} workspace={{id:"workspace",season:2026,rules}} hubContext={context} capSheet={team.cap_sheet} readOnly onChanged={onChanged} onNavigate={navigate} onOpenContractHistory={p=>navigate("history",p)}/>}
  </TeamIdentityProvider></div></main></div>;
}
createRoot(document.getElementById("root")).render(<BrowserRouter><Harness/></BrowserRouter>);
