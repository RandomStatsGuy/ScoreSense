// Current production components; every request is synthetic and no real API is contacted.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import LeagueOffice from "../src/DraftHub/LeagueOffice";
import TeamSalarySheets from "../src/DraftHub/TeamSalarySheets";
import ValueSheetTable from "../src/DraftHub/ValueSheetTable";
import { capabilitiesFromRules } from "../src/DraftHub/leagueCapabilities";
import capData from "./cap-planner-data.json";
import "../src/styles.css";
import "../src/styles/fantasy.css";
import "../src/styles/product-hierarchy.css";
import "../src/styles/product-rhythm.css";
import "../src/styles/fantasy-phone.css";
import "../src/styles/color-theme.css";
const params=new URLSearchParams(location.search),surface=params.get("surface")||"contracts",pick=params.has("pick")||surface==="moves";
const rules={...capData.rules,draft_type:pick?"snake":"auction"};
const fixture=window.__management={league:"A",team:"mine",staff:!params.has("member"),readonly:params.has("readonly"),mode:params.get("mode")||(pick?"claim":"bid"),writes:[],requests:[],callbacks:[],reads:[],delayReads:params.has("delay"),failReads:params.has("read-error")};
const teams=id=>capData.teams.map((t,i)=>({team:{...t.team,name:`${id} Team ${i+1}`,owner_name:`${id} manager ${i+1}`},roster:t.cap_sheet.planning_rows.map((r,j)=>({...r,id:(id==="A"?100:200)+i*20+j+1,player_name:`${id} ${r.player_name}`,contract_years:r.contract_years||r.contract?.years_remaining||1})),stats:{committed:t.cap_sheet.summary.spent,unspent:t.cap_sheet.summary.remaining,dead_cap:t.cap_sheet.summary.dead_cap},cap_sheet:t.cap_sheet}));
const rosters=Object.fromEntries(["A","B"].map(id=>[id,teams(id)]));
const sheets=id=>{const team_sheets=rosters[id].map(t=>({owner_label:t.team.owner_name,team_name:t.team.name,rows:t.roster.filter(r=>r.is_active).map(r=>({row_id:r.id,player_name:r.player_name,position:r.position,cap_hit:r.salary,base_salary:r.salary,prior_salary:r.salary-1,roster_status:"active",acquisition_type:"auction",source_kind:"file"})),totals:{committed:t.stats.committed,against_cap:t.stats.committed+t.stats.dead_cap,dead_cap:t.stats.dead_cap,unspent:t.stats.unspent}}));return {available:true,season_year:2026,season:2026,seasons:[2026,2025],prior_season:2025,default_salary_cap:200,data_source:"commissioner_files",team_sheets,summary_matrix:team_sheets.map(t=>({...t,seasons:{2026:t.totals,2025:t.totals}}))};};
const queue=id=>[{player_id:`queued-${id}`,player_name:`${id} Saved claim`,position:"WR",nfl_team:"BUF",drop_player_id:null}];
const priority=id=>({confirmed:!params.has("priority"),current_team_id:"mine",teams:[{team_id:"mine",team_name:`${id} manager 1`,priority:1},{team_id:"other",team_name:`${id} manager 2`,priority:2}]});
window.fetch=async(input,options={})=>{
  const url=String(input),method=options.method||"GET",league=url.match(/\/league\/([AB])\//)?.[1]||fixture.league;
  const request={url,method,league,team:fixture.team};fixture.requests.push(request);
  if(!["GET","HEAD"].includes(method)){
    const allowed=url==="/api/hub/roster"||/^\/api\/hub\/fa-market\/(bid|claims|priority)$/.test(url)||/^\/api\/hub\/league\/[AB]\/(contract-history|settings)/.test(url);
    if(!allowed)return Response.json({detail:"Unexpected fixture write blocked"},{status:405});
    const body=JSON.parse(options.body||"{}");
    return new Promise(resolve=>fixture.writes.push({...request,body,resolve:({ok=true}={})=>resolve(ok?Response.json({saved:true,claims:body.claims||queue(league),priority:priority(league),high_bid:{high_bid:body.bid_amount}}):Response.json({detail:"Synthetic save failed"},{status:503}))}));
  }
  let data={media:{},teams:[],rows:[],catalog:{}};
  if(url.includes("/rosters"))data={league:{id:league,season:2026,rules},salary_cap:200,teams:rosters[league]};
  else if(url.endsWith("/correction-context"))data={original:sheets(league).team_sheets.flatMap(t=>t.rows).find(r=>r.row_id===Number(url.split("/").at(-2))),season_year:2026,source_kind:"fixture",historic_snapshot_revision:1};
  else if(url.includes("team-salary-sheets/audit"))data={missing_players:[],rows:[]};
  else if(url.includes("team-salary-sheets"))data=sheets(league);
  else if(url.includes("/fa-market"))data={market:{my_claims:queue(league),waiver_priority:priority(league),protected_player_ids:params.has("protected")?["free-1"]:[]}};
  else if(url.includes("/members"))data={teams:rosters[league].map(t=>t.team)};
  else if(url.includes("contract-history?"))data={rows:sheets(league).team_sheets.flatMap(t=>t.rows)};
  if(fixture.delayReads&&(/rosters|fa-market|team-salary-sheets/.test(url)))return new Promise(resolve=>fixture.reads.push({...request,resolve:()=>resolve(Response.json(data))}));
  return fixture.failReads?Response.json({detail:"Synthetic read failed"},{status:503}):Response.json(data);
};
function Harness(){
  const [revision,update]=useState(0);fixture.switch=(id,team="mine")=>{fixture.league=id;fixture.team=team;update(n=>n+1);};
  fixture.permission=staff=>{fixture.staff=staff;update(n=>n+1);};fixture.readOnly=value=>{fixture.readonly=value;update(n=>n+1);};fixture.setMode=mode=>{fixture.mode=mode;update(n=>n+1);};
  const id=fixture.league,ctx={mode:"league",league_id:id,team_id:fixture.team,season:2026,is_commissioner:fixture.staff,readonly:fixture.readonly,draft_completed:!params.has("pre"),rules,capabilities:capabilitiesFromRules(rules),sleeper_league_id:params.has("sleeper")?"synthetic":null};
  const onChanged=()=>fixture.callbacks.push({league:id,team:fixture.team});
  const rows=[1,2,3].map((n)=>({player_id:`free-${n}`,player:`${id} Free player ${n}`,position:n===2?"RB":"WR",team:"BUF",season_p50:180-n,season_proj:180-n,season_p10:110,season_p90:220,per_game_proj:10,fair_value:8,tier:"Tier 3",status:"available",season_quantile_method:"mc_schedule_v1"}));
  return <div className="app"><main id="main-content"><div className="draft-hub">
    {surface==="agents"?<ValueSheetTable mode="available" rows={rows} season={2026} teamId={fixture.team} leagueId={id} inLeague rules={rules} pickDraft={pick} acquisitionWindow={{add_mode:fixture.mode,label:fixture.mode==="locked"?"Adds locked":"Waivers",message:fixture.mode==="locked"?"Adds open after the draft":"Synthetic acquisition window"}} roster={rosters[id][0].roster.filter(r=>r.is_active)} rosterIds={new Set()} onAddToRoster={onChanged} remainingCap={params.has("lowcap")?3:48} isCommissioner={fixture.staff} actionsDisabled={fixture.readonly}/>:surface==="sheets"?<TeamSalarySheets leagueId={id} seasonFilter="2026" isCommissioner={fixture.staff&&!fixture.readonly}/>:<LeagueOffice leagueId={id} hubContext={ctx} workspace={{season:2026,rules}} officeTab={pick?"rosters":"current"} onChanged={onChanged}/>}
  </div></main></div>;
}
createRoot(document.getElementById("root")).render(<BrowserRouter><Harness/></BrowserRouter>);
