// Current Strategy / mock launch / Best ball, isolated synthetic responses.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { AuthContext } from "../src/AuthContext";
import StrategyBoard from "../src/DraftHub/StrategyBoard";
import MockDraftTool from "../src/DraftHub/MockDraftTool";
import BestBallBoard from "../src/BestBallBoard";
import { boardContext, contextFingerprint, saveRankState } from "../src/DraftHub/strategyRank.js";
import { publishDataRevision } from "../src/useDataRevision.js";
import "../src/styles.css";
import "../src/styles/fantasy.css";
import "../src/styles/product-hierarchy.css";
import "../src/styles/product-rhythm.css";
import "../src/styles/fantasy-phone.css";
import "../src/styles/color-theme.css";
import "../src/styles/appearance.css";
const params=new URLSearchParams(location.search), page=params.get("page")||"strategy", state=params.get("state")||"ready";
const pick=params.get("format")==="snake";
const rules={draft_type:pick?"snake":"auction",salary_cap:200,roster_size_max:12,roster:{qb:{min:1,max:3},rb:{min:2,max:5},wr:{min:2,max:5},te:{min:1,max:3}},auction:{min_bid:1},contracts:{rookie_years:2,veteran_years:2}};
const players=Array.from({length:14},(_,i)=>({player_id:`strategy-${i}`,player:`Example ${["QB","RB","WR","TE"][i%4]} ${i+1}`,player_name:`Example player ${i+1}`,position:["QB","RB","WR","TE"][i%4],team:["BUF","DET","CIN","DAL"][i%4],season_p50:300-i*3,season_p10:200-i*2,season_p90:400-i*3,season_proj:300-i*3,fair_value:40-i,model_bid_hint:40-i,status:"available",is_available:true,is_rookie:false}));
let board=Array.from({length:120},(_,i)=>({player_id:`best-${i}`,Player:i===1?'Example, "quoted" receiver':`Example ${["QB","RB","WR/TE"][i%3]} ${i+1}`,Position:["QB","RB","WR/TE"][i%3],Team:i%2?"LA":"BUF",model_rank:Math.floor(i/3)+1,bye_week:8,"Season Proj":300-i,adp_rank:i%4?Math.floor(i/3)+14:null,value_vs_adp:i%4?13:null}));
const fixture=window.__toolsFixture={reads:[],writes:[],failQueue:false,failStart:false,failKeep:false,failRecent:state==="recent-error",failBoard:state==="error",boardReads:0,rooms:[
  {league_id:"recent-1",name:"Recent synthetic mock",season:2026,team_count:10,draft_type:"snake",status:"completed",draft_completed:true,saved:true,created_at:"2026-10-15T12:00:00Z",updated_at:"2026-10-15T12:00:00Z"},
  {league_id:"recent-2",name:"Older synthetic mock",season:2026,team_count:10,draft_type:"snake",status:"nominating",created_at:"2026-10-14T12:00:00Z"},
  {league_id:"recent-3",name:"Third synthetic mock",season:2026,team_count:10,draft_type:"auction",status:"setup",created_at:"2026-10-13T12:00:00Z"},
  {league_id:"recent-4",name:"Fourth synthetic mock",season:2026,team_count:10,draft_type:"auction",status:"setup",created_at:"2026-10-12T12:00:00Z"},
],dropEcr(){board=board.map(row=>({...row,adp_rank:null,value_vs_adp:null}));publishDataRevision();},refreshBoard(){publishDataRevision();}};
if(state.startsWith("scope")) {
  const fingerprint=contextFingerprint(boardContext({season:2026,teamCount:10,draftType:rules.draft_type}));
  for(const id of ["preview-a","preview-b"])saveRankState(id,fingerprint,{order:players.map(row=>row.player_id),seenKeys:[],feedMine:true});
}
function room(id) {
  const completed=id.startsWith("recent-");
  const teams=Array.from({length:10},(_,i)=>({id:`team-${i}`,name:`Example team ${i+1}`,owner_name:`Manager ${i+1}`,is_bot:i>0,is_commissioner:i===0,budget_remaining:200}));
  return {league:{id,name:"Synthetic practice room",test_mode:true,season:2026,team_count:10,draft_completed:completed,rules},teams,rosters:Object.fromEntries(teams.map(team=>[team.id,[]])),events:[],viewer:{team_id:"team-0",is_commissioner:true,nomination_queue:[],roster:[]},nominator_team_id:"team-0",session:{status:completed?"completed":"nominating",nomination_order:teams.map(team=>team.id),nomination_index:0,nomination_deadline:new Date(Date.now()+300000).toISOString()}};
}
window.WebSocket=class {
  static OPEN=1;readyState=1;
  constructor(url){this.id=new URL(url).pathname.split("/").at(-1);setTimeout(()=>{this.onopen?.();this.onmessage?.({data:JSON.stringify({type:"state",payload:room(this.id)})});},10);}
  send(){}close(){this.readyState=3;}
};
const originalFetch=window.fetch.bind(window);
window.fetch=async(input,options={})=>{
  const url=String(input);
  if(!url.startsWith("/api/"))return originalFetch(input,options);
  const pathname=new URL(url,location.origin).pathname, method=options.method||"GET",body=JSON.parse(options.body||"{}");
  const respond=(data,status=200)=>Response.json(structuredClone(data),{status});
  if(method!=="GET") {
    fixture.writes.push({path:pathname,method,body});
    if(pathname.endsWith("/nomination-queue")) {
      if(state==="scope-late"&&pathname.includes("preview-a")) {
        await new Promise(resolve=>{fixture.releaseQueueA=resolve;});fixture.queueAComplete=true;
        return respond({detail:"Synthetic old-league queue save failed."},503);
      }
      return fixture.failQueue?respond({detail:"Synthetic queue save failed."},503):respond({ok:true});
    }
    if(pathname==="/api/hub/mock-draft/start") {
      if(fixture.failStart)return respond({detail:"Synthetic launch failed. Your settings are retained."},503);
      fixture.createdRoom="created-room";return respond({league_id:fixture.createdRoom});
    }
    if(pathname.endsWith("/keep")) {
      if(fixture.failKeep)return respond({detail:"Synthetic pin update failed."},503);
      fixture.rooms=fixture.rooms.map(row=>pathname.includes(row.league_id)?{...row,saved:body.saved}:row);return respond({ok:true});
    }
    if(pathname.endsWith("/test/simulate"))return respond({state:room("recent-simulated")});
    if(pathname==="/api/hub/draft-room/enrichment")return respond({players:{},media:{}});
    return respond({detail:`Unimplemented synthetic write: ${method} ${pathname}`},500);
  }
  fixture.reads.push(pathname);
  if(pathname==="/api/hub/context")return respond({mode:"league",league_id:"preview-a",league_name:"Example ten-team league",team_count:10,season:2026,team_id:"team-0",is_commissioner:true,rules});
  if(pathname==="/api/hub/mock-drafts")return fixture.failRecent?respond({detail:"Synthetic recent mocks unavailable."},503):respond({rooms:state==="empty"?[]:fixture.rooms});
  if(pathname==="/api/bestball/board") {
    fixture.boardReads++;
    if(state==="loading")await new Promise(resolve=>{fixture.releaseBoard=resolve;});
    if(fixture.failBoard)return respond({detail:"Synthetic board refresh failed."},503);
    return respond({players:state==="empty"?[]:board,meta:{with_adp:board.filter(row=>row.adp_rank!=null).length}});
  }
  if(pathname.endsWith("/nomination-pool"))return respond({rows:players});
  if(pathname.endsWith("/draft-recap"))return respond({headline:"Synthetic mock complete",team_insights:[{team_id:"team-0",team_name:"Example team 1",grade:"B",headline:"Synthetic recap"}],awards:[],notable_picks:[],projected_standings:[]});
  if(pathname.endsWith("/owner-draft-report"))return respond({team_name:"Example team 1",pick_count:0,picks:[],total_spent:0,budget_remaining:200,by_position:[]});
  if(/^\/api\/hub\/league\/[^/]+$/.test(pathname))return respond(room(pathname.split("/").at(-1)));
  return respond({media:{},players:{},rows:[],items:[],messages:[],proposals:[]});
};
function Preview() {
  const [league,setLeague]=useState("preview-a");
  fixture.switchLeague=setLeague;
  const auth={ready:true,authenticated:state!=="signed-out",hubAuthRequired:true,user:{id:"synthetic-user",auth_type:"native",email_verified:state!=="unverified"},refreshAuth:async()=>{}};
  return <MemoryRouter><AuthContext.Provider value={auth}><div className="app">
    <p className="chart-note">Isolated draft tools · illustrative data · no real account or league changes</p>
    <main id="main-content"><div className="draft-hub">
      {page==="strategy"?<StrategyBoard rows={state==="empty"||state==="loading"?[]:players} loading={state==="loading"} season={2026} teamCount={10} rules={rules} pickDraft={pick} leagueId={league} inLeague leagueName={league==="preview-a"?"Example league A":"Example league B"}/>:page==="mock"?<MockDraftTool projMeta={{default_season:2026}}/>:<BestBallBoard/>}
    </div></main></div></AuthContext.Provider></MemoryRouter>;
}
createRoot(document.getElementById("root")).render(<Preview/>);
