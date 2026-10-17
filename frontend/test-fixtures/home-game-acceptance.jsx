// Production Home/Game center with synthetic snapshots and controlled HTTP races.
import React, {useState} from "react";
import {createRoot} from "react-dom/client";
import WeeklyExperience from "../src/DraftHub/WeeklyExperience";
import LeagueScoringControl from "../src/DraftHub/LeagueScoringControl";
import {getHomeCache, homeCacheKey, invalidateHomeCache} from "../src/DraftHub/hubDataCache";
import "../src/styles.css";
import "../src/styles/fantasy.css";
import "../src/styles/product-hierarchy.css";
import "../src/styles/product-rhythm.css";
import "../src/styles/fantasy-phone.css";
import "../src/styles/color-theme.css";
import "../src/styles/fantasy-chat.css";
import "../src/styles/standalone-dialogs.css";
const params=new URLSearchParams(location.search);
const qa=window.__hg={requests:[],unexpected:[],pending:[],holds:[],failures:[],overrides:[],actions:[],intervals:new Map(),nextTimer:1,
 resolve(index,data,status=200){this.pending[index].resolve(Response.json(data,{status}));},
 tick(ms){for(const timer of this.intervals.values())if(timer.ms===ms)timer.fn();},
 cache:ctx=>getHomeCache(homeCacheKey(ctx)),invalidate:invalidateHomeCache};
qa.holds=params.get("hold")?[params.get("hold")]:[];qa.failures=params.get("fail")?[params.get("fail")]:[];
window.setInterval=(fn,ms)=>{const id=qa.nextTimer++;qa.intervals.set(id,{fn,ms});return id;};
window.clearInterval=id=>qa.intervals.delete(id);
const slots=["QB","RB","RB","WR","WR","TE","FLEX","K","DEF"];
const slotIds=["QB","RB1","RB2","WR1","WR2","TE","FLEX","K","DEF"];
function context(state){return {mode:"league",league_id:state.league,season:state.season,team_id:state.team,league_name:state.league+" Sunday League",draft_completed:!state.pre,is_commissioner:state.staff,is_primary_commissioner:state.staff,readonly:state.readonly,sleeper_league_id:state.linked?"synthetic-host":null,rules:{draft_type:state.pick?"snake":"auction",salary_cap:200},capabilities:{uses_salaries:!state.pick,uses_contracts:!state.pick,economics:state.pick?"none":"salary_cap"}};}
function score(state,week=6){
 const id=state.league,kind=state.kind,pre=kind==="pregame",final=kind==="final",missing=kind==="missing",zero=kind==="zero";
 const teams=Array.from({length:6},(_,i)=>({roster_id:String(i+1),hub_team_id:String(i+1),owner_name:id+" "+["Morgan Alexandra Montgomery","Taylor Reed","Sam Lee","Jordan Davis Washington","Jamie Park","Alex Rivera"][i],team_name:id+" "+["Fourth and Forever Football Collective","Sunday Rivals","Midnight Crew","Goal Line","Fourth and Long","End Zone"][i],is_viewer:String(i+1)===state.team,wins:6-i,losses:i,ties:0,rank:i+1,points_for:missing&&i===0?null:700-i*35,points:missing&&i===0?null:zero?0:pre?null:kind==="large"?199.9+i*3.7:i===0?38:45+9*i,proj_total:missing&&i===0?null:100-i,
 starters:slots.map((slot,j)=>({slot:slotIds[j],player_id:i===0&&j===6?"":`${id}-${i}-${j}`,name:i===0&&j===6?"Empty":id+" "+["Jalen Hurts","Bijan Robinson","Bucky Irving","Justin Jefferson","Amon-Ra St. Brown","Tucker Kraft","Jordan Addison","Brandon Aubrey","Dallas Defense"][j],position:slot==="FLEX"?"WR":slot,team:"",jersey_number:j+1,game_state:pre?"pregame":final?"final":"live",points:missing&&i===0?null:zero?0:pre?null:j+1+i,proj:missing&&i===0?null:10+j,pregame_projection:j===0?null:10})),bench_players:[{player_id:`${id}-${i}-b`,name:id+" Bench Player",position:"QB",game_state:pre?"pregame":final?"final":"live",proj:20,points:pre?null:zero?0:2}]}));
 return {available:kind!=="empty",hub_context:context(state),season:state.season,week,current_week:6,max_week:18,source:state.linked?"sleeper":"hub",home_display_mode:pre?"projected":"scores",matchup_started:!pre,week_complete:final,live:!pre&&!final,has_live_games:!pre&&!final,placeholder:state.pre,reason:state.pre?"hub_unscored":undefined,synced_at:"2026-10-17T16:00:00Z",viewer_matchup_id:String(Math.ceil(Number(state.team)/2)),starting_slots:slots,standings:state.pre?[]:teams,matchups:state.pre||kind==="empty"?[]:[0,2,4].map((i,j)=>({matchup_id:String(j+1),teams:teams.slice(i,i+2)})),scoring_control:{host:state.linked?"sleeper":"native",scored:!pre,final,live:!pre&&!final,slate_complete:final?true:state.recovery?false:true,week_started:!pre,refresh:{status:state.pending?"pending":"idle"}},recent_activity:[]};
}
function home(state){return {hub_context:context(state),phase:{id:state.pre?"pre_draft":"in_season",label:state.pre?"Pre-draft":"In season",primary_cta:{view:"room",label:"Choose a night"}},cap:{uses_salaries:!state.pick,salary_cap:state.pick?null:200,remaining:state.league==="B"?79:42},pre_draft:{draft_budget_available:state.league==="B"?79:42},seating:{team_count:6,open_seats:1},draft_schedule:null,actions:state.pre?[{id:"draft_night",message:"Choose your draft night.",href:"room"}]:[],checklist:{default_view:"room"}};}
qa.score=score;qa.home=home;qa.context=context;
window.fetch=async(input,opts={})=>{
 const u=new URL(String(input),location.origin),req={url:u.pathname+u.search,method:opts.method||"GET",body:opts.body?JSON.parse(opts.body):undefined};qa.requests.push(req);
 if(qa.holds.some(part=>req.url.includes(part)))return new Promise(resolve=>qa.pending.push({...req,resolve}));
 if(qa.failures.some(part=>req.url.includes(part)))return Response.json({detail:"Fixture data unavailable"},{status:503});
 const override=qa.overrides.find(item=>req.url.includes(item.match));if(override)return Response.json(override.data,{status:override.status||200});
 if(u.pathname==="/api/hub/home")return Response.json(home({...qa.state,league:u.searchParams.get("league_id")||qa.savedFocus}));
 if(u.pathname.endsWith("/live-scoring"))return Response.json(score({...qa.state,league:u.pathname.split("/")[4]},Number(u.searchParams.get("week")||6)));
 if(u.pathname.endsWith("/score-week")&&req.method==="POST")return Response.json({scored:true,live:qa.state.kind!=="final",week:req.body.week,teams:6});
 if(u.pathname==="/api/players/media")return Response.json({media:{}});
 if(u.pathname.endsWith("/chat/summary"))return Response.json({members:[],threads:[]});
 if(u.pathname.includes("/chat/thread/"))return Response.json({messages:[]});
 if(u.pathname.endsWith("/week-culture"))return Response.json({available:false});
 qa.unexpected.push(req);return Response.json({detail:"Unexpected fixture request"},{status:404});
};
function App(){const [state,setState]=useState({view:params.get("view")||(location.pathname.endsWith("/game")?"game":"home"),league:"A",season:2026,week:params.get("matchupWeek")||null,team:params.get("team")||"1",target:params.get("matchupTeam")||null,linked:params.has("linked"),pre:params.has("pre"),staff:!params.has("member"),readonly:params.has("readonly"),pick:params.has("pick"),kind:params.get("kind")||"live",pending:params.has("pending"),recovery:params.has("recovery"),reload:0});qa.state=state;qa.savedFocus??="A";qa.update=patch=>setState(s=>({...s,...patch}));const ctx=context(state);
 return <><a className="app-skip-link" href="#main-content">Skip to content</a><main id="main-content" className="app"><div className="draft-hub">{state.view==="none"?null:state.view==="control"?<LeagueScoringControl leagueId={state.league} hubContext={ctx} data={score(state,state.week||6)} onScored={()=>qa.actions.push({scored:true})} onNavigate={(...args)=>qa.actions.push(args)}/>:<WeeklyExperience hubContext={ctx} detail={state.view==="game"} requestedWeek={state.week} requestedTeam={state.target} reloadToken={state.reload} onNavigate={(...args)=>qa.actions.push(args)}/>}</div></main></>;
}
createRoot(document.getElementById("root")).render(<App/>);
