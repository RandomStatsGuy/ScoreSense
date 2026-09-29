// Actual production Home and chrome; deterministic local-only API states.
import { BrowserRouter } from "react-router-dom";
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import LeagueHome from "../src/DraftHub/LeagueHome";
import LeagueContextBanner from "../src/DraftHub/LeagueContextBanner";
import { LeagueChromeProvider } from "../src/DraftHub/LeagueChromeContext";
import { TeamIdentityProvider } from "../src/DraftHub/TeamIdentityContext";
import MobileHeader from "../src/layout/MobileHeader";
import MobileShell from "../src/layout/MobileShell";
import MobileMenuSheet from "../src/layout/MobileMenuSheet";
import DesktopPrimaryHeader from "../src/layout/DesktopPrimaryHeader";
import HubSubnav from "../src/DraftHub/HubSubnav.jsx";
import useMobileLayout from "../src/useMobileLayout";
import "../src/styles.css";
import "../src/styles/fantasy.css";
import "../src/styles/product-hierarchy.css";
import "../src/styles/product-rhythm.css";
import "../src/styles/fantasy-phone.css";
import "../src/styles/fantasy-header.css";
import "../src/styles/color-theme.css";
const params = new URLSearchParams(location.search);
const state = params.get("state") || "season";
const pre = state === "pre" || state === "no-money";
const viewer = {roster_id:"mine",hub_team_id:"mine",owner_name:"Maya Chen",team_name:"Maya's team",is_viewer:true,points:0,proj_total:state === "missing-projection" ? null : 112.4};
const opponent = {roster_id:"them",hub_team_id:"them",owner_name:"Jordan Davis",team_name:"Jordan's team",points:0,proj_total:108.7};
const standings = [viewer,opponent].map((team,i)=>({...team,rank:i+1,wins:2,losses:1,ties:0,points_for:300}));
const originalFetch=window.fetch.bind(window);
window.__requests=[];
window.fetch=async (url,options={})=>{
  const path=String(url);
  if(!path.startsWith("/api/"))return originalFetch(url,options);
  window.__requests.push({path,method:options.method||"GET"});
  if(state === "loading" && path.includes("/home"))return new Promise(()=>{});
  if(state === "error" && /home|live-scoring/.test(path))return Response.json({detail:"League unavailable"},{status:503});
  if(path.includes("/home"))return Response.json({phase:{id:pre?"pre_draft":"in_season",label:pre?"Pre-draft":"In season",primary_cta:{view:"room",label:"Open draft room"}},actions:pre?[{id:"invite_managers",count:2,message:"Fill 2 open seats.",href:"room"},{id:"expiring_contracts",count:2,message:"2 to extend",href:"roster"}]:state==="attention"?[{id:"cap_overage",amount:5,message:"Resolve $5 cap overage",href:"planner"}]:[{id:"lineup_decisions",count:2,message:"2 lineup decisions",href:"week"}],cap:{salary_cap:state==="no-money"?null:200,remaining:42},seating:{open_seats:2,team_count:12},pre_draft:{draft_budget_available:42},draft_schedule:null});
  if(path.includes("live-scoring"))return Response.json({available:true,week:4,season:2026,home_display_mode:"projected",placeholder:pre,matchups:state === "empty" || pre ? []:[{matchup_id:"one",teams:[viewer,opponent]}],standings:pre?[]:standings,viewer_matchup_id:"one",viewer_roster_id:"mine",hub_context:{team_id:"mine",draft_completed:!pre}});
  if(path.includes("/freshness"))return Response.json({sleeper:{linked:true},projections:{available:true}});
  if(path.includes("/identities"))return Response.json({identities:{}});
  if(path.includes("/messages"))return Response.json({messages:[{id:1,team_name:"Maya Chen",body:"Anyone looking for a running back?",created_at:"2026-09-30T14:00:00Z"}],message:{id:2,team_name:"Maya Chen",body:"Ready for the week"}});
  return Response.json({});
};
function Preview(){
 const [context,setContext]=useState({mode:"league",league_id:"fixture",league_name:params.has("long")?"The Extremely Long Fantasy Football League Name":"Bottom to Top",team_id:"mine",team_name:"Maya's team",is_commissioner:state==="staff",is_primary_commissioner:state==="staff",draft_completed:!pre,season:2026,sleeper_league_id:"123"});
 const [picker,setPicker]=useState(false),[more,setMore]=useState(false);
 const mobile=useMobileLayout();
 const navigate=(view,extra)=>{window.__navigation={view,extra};setPicker(false);};
 const members=[{league_id:"fixture",league_name:context.league_name,team:{id:"mine",name:"Maya's team"}},{league_id:"second",league_name:"Sunday league",team:{id:"mine",name:"Maya's team"}}];
 return <LeagueChromeProvider><MobileShell className="app--compact-league" section="hub" onSectionChange={navigate} onMoreOpen={()=>setMore(true)} hrefForSection={id=>"#"+id}>
  <a className="app-skip-link" href="#main-content">Skip to content</a>
  <header className="app-header app-header--hub app-header--product app-header--compact-league"><div className="app-header-shell app-header-shell--hub">
   <MobileHeader title="Home" hasMenu menuOpen={picker} onTitleClick={()=>setPicker(true)} compactLeague onMoreOpen={()=>setMore(true)} />
   <DesktopPrimaryHeader productName="ScoreSense" studioName="4th Down Labs" sections={[{id:"projections",label:"Projections"},{id:"hub",label:"Fantasy"},{id:"tools",label:"Tools"}]} view="hub" pathForSection={id=>"#"+id} onNavigate={navigate} />
   <HubSubnav subView="home" hubContext={context} onNavigate={navigate} mobileLayout={mobile} pickerOnly={mobile} pickerOpen={picker} onPickerOpenChange={setPicker} />
  </div></header>
  <main id="main-content"><div className="draft-hub"><TeamIdentityProvider leagueId={context.league_id}>
   <LeagueContextBanner hubContext={context} memberships={members} onLeagueSwitch={choice=>{window.__switched=choice;setContext(prev=>({...prev,league_id:"second",league_name:"Sunday league"}));}} onCreateLeague={()=>window.__created=true} onLeagueSync={()=>window.__synced=true} showAttention={false} currentView="home" />
   <LeagueHome hubContext={context} onNavigate={navigate} onNavigateSetup={()=>navigate("rules")} />
  </TeamIdentityProvider></div></main>
  <MobileMenuSheet open={more} onClose={()=>setMore(false)} authReady authenticated user={{name:"Maya Chen"}} onGoToAccount={()=>navigate("account")} view="hub" />
 </MobileShell></LeagueChromeProvider>;
}
createRoot(document.getElementById("root")).render(<BrowserRouter><Preview /></BrowserRouter>);
