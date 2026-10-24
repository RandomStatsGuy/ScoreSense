// Production Insights with synthetic saved snapshots and controlled read races.
import React,{useState} from "react";
import {createRoot} from "react-dom/client";
import {BrowserRouter,useNavigate} from "react-router-dom";
import LeagueInsights from "../src/DraftHub/LeagueInsights";
import {ChatAuditShell} from "./chat-audit-shell";
import {setInsightsSection,getInsightsSection,clearInsightsSectionCache} from "../src/DraftHub/hubDataCache";
import "../src/styles.css";
import "../src/styles/fantasy.css";
import "../src/styles/product-hierarchy.css";
import "../src/styles/product-rhythm.css";
import "../src/styles/fantasy-phone.css";
import "../src/styles/standalone-dialogs.css";
import "../src/styles/color-theme.css";
const params=new URLSearchParams(location.search);
const qa=window.__insights={requests:[],initialState:params.get("state"),pending:[],holds:[],failures:[],overrides:[],resolve(index,payload,status=200){this.pending[index].resolve(Response.json(payload,{status}));},seed:setInsightsSection,cached:getInsightsSection,invalidate:clearInsightsSectionCache};
function rows(id,year=2025){return (params.has("chat")?Array.from({length:10},(_,i)=>i):[0,1,2]).map(i=>({owner_id:id+"owner"+i,roster_id:String(i+1),team_id:String(i+1),owner_name:id+" "+["Morgan Alexandra Montgomery","Taylor Reed","Sam Lee"][i%3]+(i>=3?" "+i:""),team_name:id+" "+["Fourth and Forever","Sunday Rivals","Midnight Crew"][i%3]+(i>=3?" "+i:""),wins:9-i,losses:4+i,ties:0,games:13,weeks_scored:13,total_points:1300-i*100,avg_points:100-i*100/13,win_pct:(9-i)/13,rank:i+1,points_for:1300-i*100,points_against:1200+i*50,season:year}));}
const analytics=id=>({positions:["QB","RB","WR","TE","K","DEF"],teams:rows(id).map((r,i)=>({...r,committed:160-i*10,unspent:40+i*10,salary_cap:200,dead_cap:5,pct_committed:80-i*5,pct_unspent:20+i*5,pct_dead_cap:2.5,spend_by_position:{QB:30,RB:50,WR:40-i*10,TE:20,K:5,DEF:10},pct_by_position:{QB:15,RB:25,WR:20-i*5,TE:10,K:2.5,DEF:5}}))});
function payload(id,section,season="current",empty=false){
 const standings=rows(id,Number(season)||2025),years=[2023,2024,2025],owner_map=Object.fromEntries(standings.map(r=>[r.team_name,r.owner_name]));
 if(params.get("state")==="zero")standings.forEach(r=>{r.total_points=0;r.points_for=0;r.avg_points=0;r.weeks_scored=1;r.wins=0;r.losses=0;r.ties=1;r.games=1;r.win_pct=0.5;});
 if(params.get("state")==="missing"){standings[2].total_points=null;standings[2].points_for=null;standings[2].avg_points=null;standings[2].weeks_scored=0;}
 const common={hub_context:{league_id:id},planning_season:2026,owner_map,analytics:{teams:[],positions:[]},historic:{available:false},efficiency:{available:false},ownership:{players:[]}};
 const career=standings.map(r=>({...r,wins:r.wins*years.length,losses:r.losses*years.length,games:r.games*years.length,total_points:r.total_points==null?null:r.total_points*years.length,weeks_scored:r.weeks_scored*years.length,seasons_played:years.length}));
 if(section==="overview")return {...common,landing:{available:!empty,source:params.has("linked")?"sleeper":"scoresense",current_season:2026,seasons:years,seasons_included:years,synced_at:"2026-10-16T18:00:00Z",partial:false,has_records:!empty,season_summaries:empty?[]:years.map(year=>({season:year,standings:rows(id,year)})),record_leaders:empty?[]:career,scoring_leaders:empty?[]:career,champions:empty?[]:years.slice().reverse().map(year=>({...standings[0],season:year,runner_up:standings[1].team_name})),most_titles:empty?null:{...standings[0],titles:3}}};
 if(section==="cap")return {...common,analytics:empty?{teams:[],positions:[]}:analytics(id),historic:{available:!empty,seasons:years,awards:empty?[]:[{id:"big_spender",title:"Saved spending award",headline:id+" old award",team_name:standings[0].team_name,tone:"good"}]}};
 if(section==="scoring")return {...common,scoring:{available:!empty,source:params.has("linked")?"sleeper":"scoresense",season:season==="current"?"2025":season,requested_season:season==="current"?"2025":season,available_seasons:years,preseason:false,standings:empty?[]:standings,weeks:empty?[]:[{week:1,teams:standings.map(r=>({...r,points:params.get("state")==="zero"?0:100}))}],awards:[],player_seasons:[]}};
 if(section==="contracts")return {...common,contracts:{seasons:years,rows:empty?[]:params.has("chat")?Array.from({length:12},(_,i)=>({deal_id:"chat-deal-"+i,player_name:"Saved Player "+i,position:"QB",salary:15+i,points:250-i,season:2025,seasons:[2025],...standings[i%standings.length]})):years.flatMap(year=>[{deal_id:"one",player_name:"Jalen Hurts",position:"QB",salary:15,points:250,weeks_saved:13,...standings[0],season:year},{deal_id:"two",player_name:"Justin Jefferson",position:"WR",salary:25,points:300,weeks_saved:13,...standings[1],season:year}]),season_status:years.map(season=>({season,ranked:2})),excluded:0}};
 return {ownership:{players:empty?[]:params.has("chat")?Array.from({length:12},(_,i)=>({player_id:"chat-player-"+i,player_name:"Saved Player "+i,position:"QB",team:"",contract_stats:{avg_cap:15,team_count:2},events:[],contract_history:[]})):[{player_id:params.has("ambiguous")?"9123":params.has("alias")?"sleeper-123":id+"-qb",player_name:id+" Jalen Hurts",position:"QB",team:"",contract_stats:{avg_cap:15,team_count:2},events:[],contract_history:[]}],player_count:empty?0:params.has("chat")?12:1,available_seasons:years,owner_map,has_contract_history:true,has_sleeper_history:params.has("linked"),ownership_synced_at:"2026-10-16T18:00:00Z"}};
}
qa.payload=payload;
if(params.has("legacy")){qa.seed("A","overview","current",{...payload("A","overview"),...payload("A","ownership")});qa.holds.push("/insights/overview");}
window.fetch=async(input,opts={})=>{
 const u=new URL(String(input),location.origin),request={url:u.pathname+u.search,method:opts.method||"GET"};qa.requests.push(request);
 if(request.method!=="GET")return Response.json({detail:"Unexpected write"},{status:405});
 if(u.pathname==="/api/players/media")return Response.json({media:{}});
 const match=u.pathname.match(/^\/api\/hub\/(?:demo\/)?league\/([^/]+)\/insights(?:\/(overview|cap|scoring|contracts))?$/);
 if(!match)return Response.json({detail:"Unexpected read"},{status:404});
 if(qa.holds.some(part=>request.url.includes(part))||qa.initialState==="loading")return new Promise(resolve=>qa.pending.push({...request,resolve}));
 if(qa.failures.some(part=>request.url.includes(part))||qa.initialState==="error")return Response.json({detail:"Fixture saved history unavailable"},{status:503});
 const override=qa.overrides.find(item=>request.url.includes(item.match));if(override)return Response.json(override.data);
 const season=u.searchParams.get("scoring_season")||u.searchParams.get("history_season")||"current";
 return Response.json(payload(match[1],match[2]||"ownership",season,qa.initialState==="empty"));
};
function App(){const [state,setState]=useState({league:"A",tab:params.get("tab")||"overview",pick:params.has("pick"),linked:params.has("linked"),readonly:params.has("readonly"),season:2026});qa.update=patch=>setState(s=>({...s,...patch}));qa.navigate=useNavigate();
 const rules={draft_type:state.pick?"snake":"auction",salary_cap:200},ctx={league_id:state.league,league_name:state.league+" Sunday League",mode:"league",season:state.season,team_id:"1",readonly:state.readonly,is_commissioner:!params.has("member"),rules,capabilities:{uses_salaries:!state.pick,uses_contracts:!state.pick},...(state.linked?{sleeper_league_id:"synthetic"}:{})};
 return <main id="main-content" className="draft-hub"><LeagueInsights leagueId={state.league} hubContext={ctx} activeTab={state.tab} onActiveTabChange={tab=>qa.update({tab})} onNavigate={target=>qa.requests.push({url:"navigate:"+target,method:"LOCAL"})}/></main>;
}
createRoot(document.getElementById("root")).render(<BrowserRouter><ChatAuditShell shell><App/></ChatAuditShell></BrowserRouter>);
