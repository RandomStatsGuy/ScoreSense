// Production live/practice room with isolated HTTP and WebSocket state.
import React from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import DraftRoom from "../src/DraftHub/DraftRoom";
import {CommunicationProvider} from "../src/DraftHub/CommunicationContext";
import MobileShell from "../src/layout/MobileShell";
import FantasyChatDock from "../src/DraftHub/FantasyChatDock";
import {hideFantasyChatDock} from "../src/DraftHub/fantasyChatPresentation";
import "../src/styles/fantasy-chat.css";
import "../src/styles.css";
import "../src/styles/fantasy.css";
import "../src/styles/product-hierarchy.css";
import "../src/styles/product-rhythm.css";
import "../src/styles/fantasy-phone.css";
import "../src/styles/tools-draft.css";
import "../src/styles/color-theme.css";
const params = new URLSearchParams(location.search);
const shell = params.get("shell") === "1";
const state = params.get("state") || "bidding", practice = params.get("practice") === "1";
const pick = params.get("format") === "snake", readonly = params.get("role") === "visitor";
const commissioner = !readonly && params.get("role") !== "member";
const setup = ["setup", "locked", "closed"].includes(state);
const completed = state === "completed";
const draftStatus = setup ? "setup" : completed ? "completed" : pick ? "picking" : state === "paused" ? "nominating" : state;
const pool = [
  {player_id:"sample-allen",name:"Josh Allen",position:"QB",team:"BUF",season_p50:350,season_p10:280,season_p90:410,fair_value:35},
  {player_id:"sample-gibbs",name:"Jahmyr Gibbs",position:"RB",team:"DET",season_p50:300,season_p10:220,season_p90:380,fair_value:60},
  {player_id:"sample-robinson",name:"Bijan Robinson",position:"RB",team:"ATL",season_p50:290,season_p10:210,season_p90:370,fair_value:58},
  {player_id:"sample-chase",name:"Ja'Marr Chase",position:"WR",team:"CIN",season_p50:300,season_p10:230,season_p90:380,fair_value:61},
].map(row=>({...row,player:row.name,player_name:row.name,status:"available",is_available:true,season_proj:row.season_p50,per_game_proj:row.season_p50/17,min_sal:1,max_sal:row.fair_value+5}));
const rules = {salary_cap:200,draft_type:pick ? "snake" : "auction",roster_size_max:12,roster:{qb:{min:1,max:3},rb:{min:2,max:5},wr:{min:2,max:5},te:{min:1,max:3},flex:{min:1,max:2}},auction:{min_bid:1,nomination_timer_sec:60,bid_timer_sec:30,late_bid_extend_sec:5},contracts:{rookie_years:2,veteran_years:2}};
const teams = Array.from({length:12},(_,i)=>({id:`sample-${i}`,name:i?`Sample team ${i+1}`:"Sunday Roster",owner_name:i?`Manager ${i+1}`:"Sample manager",budget_remaining:practice&&i===0?193:200,cap_remaining:practice&&i===0?193:200,roster_count:practice&&i===0?1:0,draft_slot:i+1,user_sub:setup && i>1 ? null : `synthetic-${i}`,is_bot:practice && i>0,is_commissioner:i===0&&commissioner}));
let room = {league:{id:"sample",name:"Sample draft room",season:2026,team_count:12,test_mode:practice,draft_completed:completed,room_code:"SAMPLE",draft_timezone:"America/Los_Angeles",draft_starts_at:state==="locked"?new Date(Date.now()+86400000).toISOString():null,rules},teams,rosters:Object.fromEntries(teams.map(t=>[t.id,practice&&t.id==="sample-0"?[{player_id:"sample-practice-keeper",player_name:"Example practice tight end",position:"TE",team:"DAL",salary:7,years_remaining:2,source:"mock"}]:[]])),events:[],picks:[],viewer:{team_id:readonly?null:"sample-0",is_commissioner:commissioner,roster:[],nomination_queue:[]},nominator_team_id:"sample-0",draft_type:rules.draft_type,claimed_humans:state==="locked"?12:2,pick:pick?{round:1,overall:1,team_id:"sample-0"}:null,roster_limits:rules.roster,session:{status:draftStatus,conduct:params.get("offline")==="1"?"offline":"live",current_nominee:!pick&&state==="bidding"?pool[0]:null,high_bid:14,high_bidder_team_id:"sample-1",paused:state==="paused",nomination_order:teams.map(t=>t.id),nomination_index:0,bid_deadline:new Date(Date.now()+300000).toISOString(),nomination_deadline:new Date(Date.now()+300000).toISOString()}};
const sockets = new Set();
const clone = value => structuredClone(value);
function broadcast() {
  // Server broadcasts omit viewer; the client must retain its private queue.
  const { viewer, ...publicState } = room;
  for (const socket of sockets) socket.onmessage?.({data:JSON.stringify({type:"state",payload:publicState})});
}
window.WebSocket = class {
  static CONNECTING=0; static OPEN=1; static CLOSING=2; static CLOSED=3;
  readyState=1;
  constructor(){sockets.add(this);setTimeout(()=>{this.onopen?.();this.onmessage?.({data:JSON.stringify({type:"state",payload:room})});},20);}
  send(message){if(message==="refresh") broadcast();}
  close(){this.readyState=3;sockets.delete(this);}
};
const fixture = window.__draftFixture = {
  writes: [], reads: [], failBid: false, delayBid: false, failAvailability: false,
  get room(){return clone(room);},
  publishRivalRoster() {
    room={...room,rosters:{...room.rosters,"sample-2":[{player_id:"sample-rival",player_name:"Example receiver with a very long surname",position:"WR",team:"DAL",salary:7,years_remaining:2,source:"draft"}]}};broadcast();
  },
  publishBid(amount, teamId="sample-2") {
    room={...room,session:{...room.session,high_bid:amount,high_bidder_team_id:teamId}};broadcast();
  },
  publishNomination(teamId="sample-1") {
    room={...room,session:{...room.session,status:"nominating",current_nominee:null,high_bid:0,high_bidder_team_id:null},nominator_team_id:teamId};broadcast();
  },
};
window.fixtureWrites=fixture.writes;
let availability = {
  can_edit: true, mine: [], submitted: 2, team_count: 12, heat: [], best: [],
  window:{state:state==="closed"?"closed":"open",dates:["2026-10-18","2026-10-19"],hours:[18,19,20],today:"2026-10-17",current_hour:12},
};
const fetchOriginal=window.fetch.bind(window);
window.fetch=async(input,options={})=>{
  const url=String(input);
  if(!url.startsWith("/api/"))return fetchOriginal(input,options);
  const pathname=new URL(url,location.origin).pathname;
  const method=options.method||"GET", body=JSON.parse(options.body||"{}");
  const respond=(data,status=200)=>Response.json(clone(data),{status});
  if(method!=="GET"){
    fixture.writes.push({path:pathname,method,body});
    if(pathname==="/api/hub/draft-room/enrichment")return respond({players:{},media:{}});
    if(readonly)return respond({detail:"Synthetic visitor cannot change this room."},403);
    if(pathname.endsWith("/bid")){
      if(fixture.delayBid)await new Promise(resolve=>{fixture.releaseBid=resolve;});
      if(fixture.failBid)return respond({detail:"Synthetic bid rejected. Check the current bid."},409);
      room={...room,session:{...room.session,high_bid:body.amount,high_bidder_team_id:"sample-0"}};return respond(room);
    }
    if(pathname.endsWith("/nominate")){
      const row=pool.find(row=>row.player_id===body.player_id);
      room={...room,session:{...room.session,status:"bidding",current_nominee:row,high_bid:1,high_bidder_team_id:"sample-0"}};return respond(room);
    }
    if(pathname.endsWith("/pick")){
      const row=pool.find(row=>row.player_id===body.player_id);
      const event={id:"synthetic-pick-1",event_type:"pick",payload:{...body,team_id:"sample-0",round:1,overall:1}};
      room={...room,rosters:{...room.rosters,"sample-0":[{...row,source:"draft",years_remaining:1}]},events:[event],picks:[event],
        nominator_team_id:"sample-1",pick:{round:1,overall:2,team_id:"sample-1"},session:{...room.session,nomination_index:1}};
      return respond(room);
    }
    if(pathname.endsWith("/nomination-queue")){
      room={...room,viewer:{...room.viewer,nomination_queue:body.player_ids,autodraft:body.autodraft}};return respond(room);
    }
    if(pathname.endsWith("/pause")||pathname.endsWith("/resume")){
      room={...room,session:{...room.session,paused:pathname.endsWith("/pause")}};return respond(room);
    }
    if(pathname.endsWith("/test/simulate")){
      room={...room,simulation:{status:"running",done:1,total:4}};broadcast();
      await new Promise(resolve=>{fixture.releaseSimulation=resolve;});
      return respond({state:room});
    }
    if(pathname.endsWith("/availability")){
      if(fixture.failAvailability)return respond({detail:"Synthetic availability save failed."},503);
      availability={...availability,mine:body.slots};return respond(availability);
    }
    if(pathname.endsWith("/settings")){
      room={...room,league:{...room.league,...body}};return respond(room);
    }
    if(method==="DELETE"&&pathname==="/api/hub/league/sample"){
      fixture.deleted=true;return respond({ok:true});
    }
    return respond({detail:`Unimplemented synthetic write: ${method} ${pathname}`},500);
  }
  fixture.reads.push(pathname);
  if(pathname.endsWith("/availability"))return respond(availability);
  if(pathname.endsWith("/draft-recap"))return respond({headline:"Sample draft complete",subheadline:"Illustrative recap",team_insights:[{team_id:"sample-0",team_name:"Sunday Roster",grade:"B",headline:"Sample roster review"}],awards:[],notable_picks:[],projected_standings:[]});
  if(pathname.endsWith("/owner-draft-report"))return respond({team_name:"Sunday Roster",pick_count:0,picks:[],total_spent:0,budget_remaining:200,by_position:[]});
  if(pathname.endsWith("/nomination-pool"))return respond({rows:pool});
  if(pathname.endsWith("/trades"))return respond({proposals:[]});
  if(pathname.endsWith("/draft-expire-preview"))return respond({rows:[]});
  if(pathname==="/api/hub/league/sample")return respond(room);
  if(shell&&pathname.endsWith("/chat/summary"))return respond({threads:[],members:[{id:"sample-0",name:"Sample manager",team_name:"Sunday Roster",can_message:true},{id:"sample-1",name:"Manager with a very long surname",team_name:"Another very long fantasy team name",can_message:true}],notifications:[],preferences:{},unread:0});
  if(pathname.includes("/messages")||pathname.includes("/chat"))return respond({messages:[],channels:[]});
  return respond({media:{},players:{},items:[]});
};
function FixtureRoot() {
  const [exited, setExited] = React.useState(false);
  const [leagueId, setLeagueId] = React.useState("sample");
  const content = <>
    <p className="chart-note">Isolated draft preview · synthetic data · no real league changes</p>
    <main id="main-content"><div className="draft-hub">
      {exited ? <p role="status">Practice room discarded.</p> : <DraftRoom leagueId={leagueId}
        onLeagueIdChange={id=>{fixture.changedLeague=id;setLeagueId(id);}}
        onExitRoom={()=>{fixture.exited=true;setExited(true);}} valueRows={pool} season={2026}
        toolMode={practice} toolLabel={practice?"Mock draft":"Draft"}
        hubContext={{mode:"league",league_id:"sample",league_name:"Sample draft room",team_id:readonly?null:"sample-0",is_commissioner:commissioner,rules}} />}
    </div></main></>;
  return <MemoryRouter>{shell ? <CommunicationProvider enabled identity="draft-chat-audit" hubContext={{mode:"league",league_id:"sample",team_id:readonly?null:"sample-0"}}><MobileShell section={practice?"tools":"hub"} onSectionChange={()=>{}} onMoreOpen={()=>{}} hrefForSection={id=>`#${id}`}>
    {content}<FantasyChatDock leagueId="sample" hidden={hideFantasyChatDock({hidden:params.get("duplicateChat")!=="1"})}/>
  </MobileShell></CommunicationProvider> : <div className="app">{content}</div>}</MemoryRouter>;
}
createRoot(document.getElementById("root")).render(<FixtureRoot />);
