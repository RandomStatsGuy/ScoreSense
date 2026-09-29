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
import RosterBuilder from "../src/DraftHub/RosterBuilder";
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
const state = params.get("state") || "salary";
const usesSalaries = state !== "standard";
const rules = {salary_cap:200,draft_type:usesSalaries?"auction":"snake",contracts:{max_years:3,extension_step_up:5,allow_veteran_renewal:true,cut_refund_pct:0.5}};
const context = {mode:"league",league_id:"fixture",team_id:"mine",owner_name:params.has("long")?"Alexandria Montgomery with a very long manager name":"Maya Chen",team_name:"Sunday Roster",draft_completed:state!=="predraft",is_commissioner:params.has("staff"),capabilities:{uses_salaries:usesSalaries,uses_contracts:usesSalaries},rules};
let roster = [
  ["allen","Josh Allen","QB","BUF",33,2,"veteran"],
  ["daniels","Jayden Daniels","QB","WAS",3,3,"rookie"],
  ["bijan","Bijan Robinson","RB","ATL",28,2,"rookie"],
  ["cook","James Cook","RB","BUF",16,state==="predraft"?1:2,"veteran"],
  ["charbonnet","Zach Charbonnet","RB","SEA",5,2,"rookie"],
  ["lamb","CeeDee Lamb","WR","DAL",35,3,"extension"],
  ["smith","DeVonta Smith","WR","PHI",18,state==="predraft"?1:2,state==="predraft"?"extension":"veteran"],
  ["mcbride","Trey McBride","TE","ARI",14,2,"rookie"],
].map(([id,name,pos,team,salary,years,type],index)=>({id:`slot-${id}`,player_id:id,player_name:params.has("long")&&index===0?"An Exceptionally Long Player Name With Multiple Surnames":name,position:pos,team,salary,contract_years:years,roster_status:"active",contract:{years_remaining:years,contract_type:type,current_salary:salary}}));
if(state==="empty")roster=[];
if(state==="cut")roster[0]={...roster[0],roster_status:"cut_before_draft",can_undo_cut:false,claimed_by_owner:"Jordan Davis"};
window.fixtureWrites=[];
window.fetch=async(input,options={})=>{
  const path=String(input);
  if(options.method&&options.method!=="GET") {
    const body=JSON.parse(options.body||"{}");
    window.fixtureWrites.push({path,method:options.method,body});
    if(state==="write-error")return Response.json({detail:"Could not save the roster change."},{status:503});
    if(path==="/api/hub/roster")roster=roster.map(row=>row.player_id===body.player_id?{...row,roster_status:body.roster_status||row.roster_status}:row);
    if(path.endsWith("/rookie-extend/cancel"))roster=roster.map(row=>row.player_id===body.player_id?{...row,contract:{...row.contract,pending_extension:null}}:row);
    else if(path.endsWith("/rookie-extend"))roster=roster.map(row=>row.player_id===body.player_id?{...row,contract:{...row.contract,pending_extension:{years:body.extension_years,start_salary:21}}}:row);
    return Response.json({pending_extension:true,extension_years:body.extension_years,start_salary:21});
  }
  if(path.includes("identities"))return Response.json({identities:{}});
  if(path.includes("freshness"))return Response.json({sleeper:{linked:false},projections:{available:true}});
  if(path.includes("/room"))return Response.json({team:{id:"mine",name:"Sunday Roster",owner_name:context.owner_name},theme:"cozy",season:2026,week:4,state:"pregame",can_edit:true,starters:[],bench:[],teams:[]});
  return Response.json({});
};
function Preview() {
  const [ctx,setContext]=useState({...context,league_name:params.has("long")?"The Extremely Long Fantasy Football League Name":"Bottom to Top"});
  const [version,setVersion]=useState(0),[picker,setPicker]=useState(false),[more,setMore]=useState(false);
  const mobile=useMobileLayout();
  const navigate=(view)=>{window.fixtureDestination=view;setPicker(false);};
  const members=[{league_id:"fixture",league_name:ctx.league_name,team:{id:"mine",name:"Sunday Roster"}}];
  const remaining=state==="predraft"?76:42;
  const capSheet={summary:{remaining,salary_cap:200,spent:200-remaining-6,dead_cap:6},pre_draft:state==="predraft"?{season_committed:118,dead_cap:6,draft_budget_available:76}:null};
  return <LeagueChromeProvider><MobileShell className="app--compact-league" section="hub" onSectionChange={navigate} onMoreOpen={()=>setMore(true)} hrefForSection={id=>"#"+id}>
    <a className="app-skip-link" href="#main-content">Skip to content</a>
    <header className="app-header app-header--hub app-header--product app-header--compact-league"><div className="app-header-shell app-header-shell--hub">
      <MobileHeader title="My team" hasMenu menuOpen={picker} onTitleClick={()=>setPicker(true)} compactLeague onMoreOpen={()=>setMore(true)} />
      <DesktopPrimaryHeader productName="ScoreSense" studioName="4th Down Labs" sections={[{id:"projections",label:"Projections"},{id:"hub",label:"Fantasy"},{id:"tools",label:"Tools"}]} view="hub" pathForSection={id=>"#"+id} onNavigate={navigate} />
      <HubSubnav subView="roster" hubContext={ctx} onNavigate={navigate} mobileLayout={mobile} pickerOnly={mobile} pickerOpen={picker} onPickerOpenChange={setPicker} />
    </div></header>
    <main id="main-content"><div className="draft-hub"><TeamIdentityProvider leagueId={ctx.league_id}>
      <LeagueContextBanner hubContext={ctx} memberships={members} onLeagueSwitch={()=>setContext(prev=>({...prev,league_id:"second"}))} onCreateLeague={()=>{}} onLeagueSync={()=>{}} showAttention={false} currentView="roster" />
      <RosterBuilder roster={roster} loading={state==="loading"} hubContext={ctx} workspace={{season:2026,rules}} capSheet={state==="loading"?null:capSheet} readOnly={!ctx.is_commissioner} onChanged={()=>setVersion(version+1)} onNavigate={navigate} onOpenContractHistory={(id)=>{window.fixtureHistory=id;}} onEditInOffice={()=>navigate("office")} />
    </TeamIdentityProvider></div></main>
    <MobileMenuSheet open={more} onClose={()=>setMore(false)} authReady authenticated user={{name:"Maya Chen"}} onGoToAccount={()=>navigate("account")} view="hub" />
  </MobileShell></LeagueChromeProvider>;
}
createRoot(document.getElementById("root")).render(<MemoryRouter><Preview /></MemoryRouter>);
