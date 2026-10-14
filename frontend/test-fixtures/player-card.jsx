// Production player inspector; synthetic data only, no remote API or league writes.
import React, {useState} from "react";
import {createRoot} from "react-dom/client";
import PlayerCardModal from "../src/PlayerCardModal";
import "../src/styles.css";
import "../src/styles/projections-experience.css";
import "../src/styles/product-hierarchy.css";
import "../src/styles/product-rhythm.css";
import "../src/styles/fantasy-phone.css";
import "../src/styles/color-theme.css";
const params=new URLSearchParams(location.search);
const state=params.get("state")||"ready";
const position=params.get("position")||"qb";
document.documentElement.dataset.theme=params.get("theme")||"dark";
const player={playerId:"qb1",name:"Josh Allen",team:"BUF",position,season:2026,week:6};
const logs=[29.6,22.1,30.5,20.5,26.7,0,16.2].map((points,index)=>({week:7-index,opponent:"NE",is_home:index%2===0,points,passing_yards:240,rushing_yards:32,receiving_yards:65,receptions:5,touchdowns:2}));
const total=logs.reduce((sum,row)=>sum+row.points,0);
const payload={player_id:"qb1",player_name:player.name,team:"BUF",position,
 media:{team:"BUF",headshot_url:"https://a.espncdn.com/i/headshots/nfl/players/full/3918298.png"},
 weekly_projection:{"Projected Points":24.8,"Low (P10)":17.2,"High (P90)":33.4},
 rest_of_season_projection:{p10:216,p50:257.6,p90:302,games_remaining:10},
 preseason_projection:{p10:283,p50:344,p90:403},preseason_baseline:{points:344,games:17,built_at:"2026-08-15T00:00:00Z"},
 season_to_date:{season:2026,points:total,ppg:total/7,games_played:7,through_week:7,complete:true},
 game_log:logs,game_log_season:2026,injury:state==="questionable"?{injury_status:"Questionable",injury_body_part:"Ankle"}:null,
 meta:{season:2026,week:8,preseason_mode:state==="preseason",built_at:"2026-10-13T17:00:00Z"}};
if(state==="missing")Object.assign(payload,{weekly_projection:null,rest_of_season_projection:null,preseason_baseline:null,game_log:[],season_to_date:{points:null,ppg:null,games_played:null,complete:false}});
if(state==="no-baseline")payload.preseason_baseline=null;
if(state==="behind")payload.preseason_baseline={points:460,games:17};
window.fetch=async(input,{signal}={})=>{
 const url=String(input);
 if(url.includes('/card')){
  if(state==="loading")return new Promise((_,reject)=>signal?.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError'))));
  if(state==="error")return new Response(JSON.stringify({detail:"Player details are unavailable."}),{status:503,headers:{"Content-Type":"application/json"}});
  return new Response(JSON.stringify(payload),{headers:{"Content-Type":"application/json"}});
 }
 if(url.includes('/context'))return new Response(JSON.stringify({player_id:"qb1",this_week:{detail:"Limited at practice this week.",source:"Practice report"},media_context:{state:"none"},meta:{season:2026,week:8}}),{headers:{"Content-Type":"application/json"}});
 return new Response('{}',{status:404,headers:{"Content-Type":"application/json"}});
};
function Fixture(){
 const[request,setRequest]=useState(null);
 return <><main id="main-content" style={{padding:"var(--space-5)"}}><h1>Player card verification</h1><p>Sample data · Production components</p><button className="btn-ghost" style={{minHeight:44}} onClick={()=>setRequest({...player,playerName:player.name,scope:"weekly"})}>Open Josh Allen</button></main>
 {request?<PlayerCardModal request={request} onClose={()=>setRequest(null)} candidates={[player]} onSelectPlayer={()=>setRequest({...player,playerName:player.name,scope:"weekly"})} onToggleCompare={()=>{}}/>:null}</>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
