// Real Fantasy views with synthetic data. Requests never reach a league API.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import MobileShell from "../src/layout/MobileShell";
import MobileHeader from "../src/layout/MobileHeader";
import StrategyBoard from "../src/DraftHub/StrategyBoard";
import CapPlanner from "../src/DraftHub/CapPlanner";
import VibeRankings from "../src/DraftHub/VibeRankings";
import WeekLineupBoard from "../src/DraftHub/WeekLineupBoard";
import LeagueOffice from "../src/DraftHub/LeagueOffice";
import DraftLobby from "../src/DraftHub/DraftLobby.jsx";
import RulesWizard from "../src/DraftHub/RulesWizard";
import ValueSheetTable from "../src/DraftHub/ValueSheetTable";
import { TeamIdentityProvider } from "../src/DraftHub/TeamIdentityContext";
import { CommunicationProvider } from "../src/DraftHub/CommunicationContext";
import ChatLauncher from "../src/DraftHub/ChatLauncher";
import CommunicationPanel from "../src/DraftHub/CommunicationPanel";
import "../src/styles.css";
import "../src/styles/fantasy.css";
import "../src/styles/product-hierarchy.css";
import "../src/styles/product-rhythm.css";
import "../src/styles/fantasy-phone.css";
import "../src/styles/color-theme.css";
import "../src/styles/fantasy-chat.css";

const query = new URLSearchParams(location.search);
const view = query.get("view") || "strategy";
document.documentElement.dataset.theme = query.get("theme") || "dark";
const pick = query.get("format") === "pick";
const context = {mode:"league",league_id:"spacing-fixture",league_name:"A league with a long display name",team_id:"mine",team_name:"Maya Chen",season:2026,draft_completed:true,is_commissioner:true,is_primary_commissioner:true};
const rules = {salary_cap:200,team_count:6,draft_type:pick?"snake":"auction",scoring:{ppr:1},roster:{QB:1,RB:2,WR:2,TE:1,FLEX:1,BN:4},contracts:{max_years:3,cut_refund_pct:.5,step_up_per_year:3,allow_veteran_renewal:true},auction:{min_bid:1}};
const rows = ["Jayden Reed", "Equanimeous Tristan Imhotep St. Brown", "Amon-Ra St. Brown", "Parker Washington", "Jaxon Smith-Njigba", "Malik Nabers", "Christian Watson", "Marquez Valdes-Scantling", "Josh Downs"].map((name,index) => ({
  player_id:`player-${index}`,player_name:name,player:name,name,team:index%2?"DET":"GB",position:"WR",salary:10+index,fair_value:15+index,season_p50:230-index*2,season_p10:150-index,season_p90:300-index,season_proj:230-index*2,
  p50:13+index,p10:8,p90:20,contract_years:2,years_remaining:2,contract:{current_salary:10+index,years_remaining:2,contract_type:"veteran",schedule:[{year_offset:0,salary:10+index},{year_offset:1,salary:10+index}]},
}));
const teams=[{id:"mine",name:"Maya's team",owner_name:"Maya Chen",user_sub:"mine",draft_slot:1},{id:"other",name:"Another team with a much longer name",owner_name:"Alexandra Montgomery",user_sub:"other",draft_slot:2}];
const capSheet={season:2026,summary:{salary_cap:200,total_salary:126,spent:126,remaining:65,dead_cap:9,available_cap:65,remaining_cap:65,committed_salary:126,roster_count:9,by_position_count:{WR:9},by_position_spend:{WR:126}},validation_errors:[],multi_year_plan:[{year_offset:0,salary:126,dead_cap:9,total:135,remaining:65},{year_offset:1,salary:126,dead_cap:0,total:126,remaining:74}],pre_draft:{must_extend:[],dropping_at_draft:[],queued_extensions:[]}};
window.fixtureWrites=[];
const originalFetch=window.fetch.bind(window);
window.fetch=async(input,options={})=>{
  const url=new URL(typeof input==="string"?input:input.url,location.origin);
  if(!url.pathname.startsWith('/api/'))return originalFetch(input,options);
  if((options.method||'GET')!=='GET'){window.fixtureWrites.push(url.pathname);return Response.json({detail:"Fixture write rejected"},{status:409});}
  if(url.pathname.endsWith('/manager-accounts'))return Response.json({accounts:[{account_sub:'mine',display_name:'Maya Chen',team_name:'Sunday Rivals'},{account_sub:'other',display_name:'Jordan Davis',team_name:'Midnight Crew'}],sources:Array.from({length:6},(_,i)=>({source_kind:'import_label',label:'Saved manager '+i,seasons:[2024,2025]})),mappings:Array.from({length:6},(_,i)=>({id:i+1,account_sub:i%2?'other':'mine',manager_name:'Saved manager '+i,source_label:'Imported manager '+i,display_name:i%2?'Jordan Davis':'Maya Chen',source_kind:'import_label',season_year:0}))});
  if(url.pathname.endsWith('/members'))return Response.json({teams,commissioner_sub:"mine",team_count:6,capacity:6,claimed_humans:2});
  if(url.pathname.endsWith('/rosters'))return Response.json({teams:teams.map(team=>({team,roster:team.id==='mine'?rows:rows.slice(0,2),stats:{unspent:65,committed:126,dead_cap:9}})),rules,season:2026,source_version:'fixture'});
  if(url.pathname.includes('/draft-availability'))return Response.json({available:false,closed:true,teams:[],slots:[],timezone:"America/New_York"});
  if(url.pathname==='/api/hub/week')return Response.json({roster:{starters:rows.slice(0,3).map((p,i)=>({...p,slot:`WR${i+1}`})),bench:rows.slice(3,5)},meta:{season:2026,week:6},starters:rows.slice(0,3).map((p,index)=>({slot:`WR${index+1}`,player_id:p.player_id,player_name:p.player_name,team:p.team,position:p.position,p50:p.p50,proj:p.p50})),bench:rows.slice(3,5),counts:{roster:5},hub_context:context});
  if(url.pathname.includes('/chat/summary'))return Response.json({threads:[],members:[],notifications:[],preferences:{},unread:0});
  return Response.json({identities:{},media:{},players:[],teams:[],rosters:{},preferences:{},messages:[],history:[],slots:{},rules});
};
function Preview(){
  const [week,setWeek]=useState(6),[office,setOffice]=useState(query.get('tab')||'members');
  const player=p=>({...p,game_state:'pregame',proj:p.p50,player_id:p.player_id});
  const page=view==='strategy'?<StrategyBoard rows={rows} season={2026} teamCount={6} rules={rules} pickDraft={pick} leagueId="spacing-fixture" inLeague />
    :view==='rules'?<RulesWizard workspace={{id:context.league_id,name:context.league_name,season:2026,rules}} hubContext={context}/>
    :view==='agents'?<ValueSheetTable leagueId={context.league_id} season={2026} inLeague pickDraft={pick} rules={rules} mode="available" acquisitionWindow={{add_mode:'bid',message:'Waivers are open'}} title="Free agents" rosterIds={new Set()} sleeper={[]} rows={rows.map(row=>({...row,status:"available"}))}/>
    :view==='cap'?<CapPlanner capSheet={capSheet} roster={rows} workspace={{season:2026,rules}} hubContext={context}/>
    :view==='vibes'?<VibeRankings hubContext={context}/>
    :view==='week'?<WeekLineupBoard weekLabel={`Week ${week}`} weekValue={week} onWeekChange={setWeek} canEdit slots={rows.slice(0,3).map((p,i)=>({key:`WR${i+1}`,slot:`WR${i+1}`,player:player(p)}))} bench={rows.slice(3,5).map(player)} />
    :view==='draft'?<DraftLobby league={{id:context.league_id,name:context.league_name,team_count:6,room_code:"SAMPLE",season:2026,rules}} leagueId={context.league_id} rules={rules} teams={teams} viewer={{team_id:"mine"}} hubContext={{...context,draft_completed:false}} claimedHumans={2} isCommissioner />
    :<LeagueOffice leagueId={context.league_id} hubContext={context} workspace={{season:2026,rules}} officeTab={office} onOfficeTabChange={setOffice}/>;
  return <MobileShell section="hub" onSectionChange={()=>{}} onMoreOpen={()=>{}} hrefForSection={id=>`#${id}`}>
    <header className="app-header"><MobileHeader title={view==='cap'?'Cap':view==='office'?'Roster management':view==='week'?'This Week':view[0].toUpperCase()+view.slice(1)}/></header>
    <main id="main-content"><div className="draft-hub" data-fixture-view={view}>{page}</div><button className="btn-ghost" data-layout-tail>End of fixture</button></main>
    <ChatLauncher leagueId={context.league_id}/><CommunicationPanel/>
  </MobileShell>;
}
createRoot(document.getElementById('root')).render(<MemoryRouter><TeamIdentityProvider leagueId={context.league_id}><CommunicationProvider enabled identity="fantasy-spacing-fixture" hubContext={context}><Preview/></CommunicationProvider></TeamIdentityProvider></MemoryRouter>);
