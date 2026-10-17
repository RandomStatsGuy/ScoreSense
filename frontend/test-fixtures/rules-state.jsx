// Production Rules/setup components. Only queued synthetic Rules saves are allowed.
import React,{useState} from "react";
import {createRoot} from "react-dom/client";
import {BrowserRouter} from "react-router-dom";
import {AuthContext} from "../src/AuthContext";
import RulesWizard from "../src/DraftHub/RulesWizard";
import HubSetup from "../src/DraftHub/HubSetup";
import {allowUnsavedNavigation} from "../src/unsavedNavigation";
import {DEFAULT_RULES,mergeLeagueRules} from "../src/DraftHub/rulesPresentation";
import {capabilitiesFromRules} from "../src/DraftHub/leagueCapabilities";
import "../src/styles.css";
import "../src/styles/fantasy.css";
import "../src/styles/product-hierarchy.css";
import "../src/styles/product-rhythm.css";
import "../src/styles/fantasy-phone.css";
import "../src/styles/fantasy-header.css";
import "../src/styles/color-theme.css";
const params=new URLSearchParams(location.search);
const role=params.get("role")||"commissioner",format=params.get("format")||"auction",host=params.get("host")||"native";
const makeLeague=id=>{
  const rules=mergeLeagueRules({...DEFAULT_RULES,draft_type:format});
  const context={mode:"league",league_id:id,league_name:`Example league ${id}`,team_id:`team-${id}`,team_name:`Example team ${id}`,season:2026,is_commissioner:role==="commissioner",draft_completed:false,rules,capabilities:capabilitiesFromRules(rules),draft_timezone:"America/Los_Angeles",draft_starts_at:null,...(host==="sleeper"?{sleeper_league_id:`synthetic-${id}`}:{})};
  return {context,workspace:{id:`workspace-${id}`,name:context.league_name,season:2026,rules,preset_id:"standard",sleeper_roster_id:host==="sleeper"?"1":"",hub_context:context}};
};
const fixture=window.__rulesFixture={requests:[],saves:[],callbacks:[],leagues:{A:makeLeague("A"),B:makeLeague("B")}};
window.fetch=async(input,options={})=>{
  const url=String(input),method=options.method||"GET";
  fixture.requests.push({url,method});
  if(method==="PUT"&&url==="/api/hub/workspace"){
    const body=JSON.parse(options.body),index=fixture.saves.length;
    return new Promise(resolve=>fixture.saves.push({body,resolve:({ok=true,normalizeName}={})=>{
      const saved={...body,name:normalizeName??body.name};
      if(ok){const league=fixture.leagues[body.league_id];league.context={...league.context,league_name:saved.name,season:saved.season,rules:saved.rules};league.workspace={...league.workspace,...saved,hub_context:league.context};}
      resolve(ok?Response.json({...fixture.leagues[body.league_id].workspace,saved,saved_league_id:body.league_id}):Response.json({detail:`Synthetic save ${index+1} failed`},{status:503}));
    }}));
  }
  if(!["GET","HEAD"].includes(method))return Response.json({detail:"Unexpected fixture write rejected"},{status:405});
  if(url.includes("pending-types"))return Response.json({pending:[]});
  if(url.includes("/members"))return Response.json({teams:[]});
  return Response.json({teams:[],players:[],memberships:[],rows:[],links:[],accounts:[],media:{}});
};
function Harness(){
  const [leagueId,setLeagueId]=useState("A"),[revision,setRevision]=useState(0),[page,setPage]=useState(params.get("page")||"rules");
  fixture.switchLeague=id=>setLeagueId(id);
  fixture.refresh=()=>setRevision(value=>value+1);
  fixture.navigate=async target=>{if(await allowUnsavedNavigation(`/hub/${target}`))setPage(target);};
  const {context,workspace}=fixture.leagues[leagueId];
  const presets=[{id:"pick-template",label:"Pick template",rules:{...DEFAULT_RULES,draft_type:"snake"}}];
  const onSaved=(data,meta)=>{fixture.callbacks.push({data,meta,current:leagueId});if(meta.boundLeagueId===leagueId)setRevision(value=>value+1);};
  return <div className="app"><main id="main-content"><div className="draft-hub">
    {page==="rules"?<RulesWizard workspace={workspace} hubContext={context} presets={presets} readOnlyRules={role!=="commissioner"} onSaved={onSaved}/>:<HubSetup workspace={workspace} hubContext={context} memberships={[{league_id:leagueId,league_name:context.league_name,team:{id:context.team_id,name:context.team_name},is_commissioner:context.is_commissioner}]} roster={[]} presets={presets} onNavigate={target=>fixture.navigate(target)}/>}
  </div></main></div>;
}
const auth={ready:true,authenticated:true,user:{sub:"fixture-user",name:"Example manager",email_verified:true,auth_type:"native"},refreshAuth:async()=>{}};
createRoot(document.getElementById("root")).render(<BrowserRouter><AuthContext.Provider value={auth}><Harness/></AuthContext.Provider></BrowserRouter>);
