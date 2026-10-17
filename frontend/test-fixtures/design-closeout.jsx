// Supporting acceptance only. No real account, admin, room, or lobby writes.
import React,{useState} from "react";
import {createRoot} from "react-dom/client";
import {MemoryRouter,Routes,Route,useLocation} from "react-router-dom";
import {AuthContext} from "../src/AuthContext";
import {AppearanceProvider} from "../src/AppearanceProvider";
import {AuthCallbackPage,AuthVerifyPage} from "../src/AuthPages";
import AdminPortal from "../src/AdminPortal";
import AccuracyChart from "../src/AccuracyChart";
import SharedTeamRoom from "../src/DraftHub/SharedTeamRoom";
import LobbyJoinPage from "../src/DraftHub/LobbyJoinPage";
import {getToken} from "../src/auth";
import "../src/styles.css";
import "../src/styles/product-hierarchy.css";
import "../src/styles/product-rhythm.css";
import "../src/styles/projections-experience.css";
import "../src/styles/fantasy-phone.css";
import "../src/styles/fantasy-header.css";
import "../src/styles/color-theme.css";
import "../src/styles/appearance.css";
const kind=new URLSearchParams(location.search).get("case")||"model-ready";
const qa=window.__closeout={requests:[],path:"",failRoom:kind==="public-error",getToken};
const user={sub:"example-user",id:"example-user",name:"Example manager",email:"example@example.test",auth_type:"native",email_verified:true,is_admin:true};
const report={position:"qb",seasons:[2024,2025],series:{scoresense:[4.3,4.1],site_composite:[4.6,4.4],season_avg:[4.7,null],last_game:[5.1,5]},summary:{scoresense_avg_mae:4.2,site_composite_avg_mae:4.5,scoresense_beats_composite_seasons:2,total_seasons:2},notes:"Synthetic acceptance fixture; these numbers are not model performance evidence."};
const room={team:{id:"public-team",name:"Example public team",owner_name:"Example manager"},theme:"none",season:2026,week:6,current_week:6,max_week:18,state:"live",lineup_host:"scoresense",can_edit:false,starters:kind==="public-empty"?[]:[{player_id:"example-qb",name:"Example quarterback",position:"QB",slot:"QB",team:"BUF",points:0,projection:null,can_manage:false,lineup_locked:true}],bench:[],score:0,opponent:null,media:{},synced_at:"2026-10-17T00:00:00Z",teams:[]};
window.fetch=async(input,options={})=>{
 const path=String(input),method=options.method||"GET";qa.requests.push({path,method});
 if(path.endsWith("/join")&&method==="POST")return Response.json({detail:"Example join failure"},{status:503});
 if(!["GET","HEAD"].includes(method))return Response.json({detail:"Closeout fixture rejects writes"},{status:405});
 if(path.includes("/shared-room/"))return qa.failRoom?Response.json({detail:"Example missing share"},{status:404}):Response.json(room);
 if(path.includes("/api/hub/lobby/")){
  if(kind==="lobby-missing")return Response.json({detail:"Example missing lobby"},{status:404});
  const full=kind==="lobby-full",member=kind==="lobby-member";
  return Response.json({league_id:"example-lobby",name:"Example practice room",test_mode:!member,can_walk_in:!full&&!member,can_join:!full,team_count:4,claimed:full?4:3,status:full?"drafting":"setup",draft_type:"snake",season:2026});
 }
 if(path.includes("/api/hub/league/"))return Response.json({detail:"Example nonmember"},{status:403});
 if(path.includes("/admin/ops/overview"))return Response.json({attention:[],upcoming:[],resources:{},jobs:[]});
 if(path.includes("/admin/overview"))return Response.json({native_user_count:1,live_league_count:1,test_league_count:0,bot_sub_count:0});
 if(path.includes("/admin/users"))return Response.json({accounts:[{...user,user_sub:user.sub,memberships:[]}],system_subs:[]});
 if(path.includes("/admin/leagues"))return Response.json({count:1,leagues:[{id:"example-league",name:"Example long league name for directory review",room_code:"SAMPLE",season:2026,member_count:3,team_rows:4,commissioner_email:user.email}]});
 return Response.json({});
};
function Bridge(){qa.path=useLocation().pathname;return null;}
function Supporting(){
 const [tab,setTab]=useState("users");
 return <AuthContext.Provider value={{ready:true,authenticated:kind!=="lobby-member",user,hubAuthRequired:false,isAdmin:true,refreshAuth:async()=>{}}}><AppearanceProvider><Bridge/>
 {kind.startsWith("model")?<div className="app"><a className="app-skip-link" href="#main-content">Skip to content</a><main id="main-content" tabIndex={-1}><h1>Model accuracy</h1><AccuracyChart report={kind==="model-ready"?report:null}/></main></div>:
 kind==="admin"?<div className="app"><a className="app-skip-link" href="#main-content">Skip to content</a><main id="main-content" tabIndex={-1}><AdminPortal adminTab={tab} onAdminTabChange={setTab}/></main></div>:
 <Routes><Route path="/team-room/:token" element={<SharedTeamRoom/>}/><Route path="/lobby/:roomCode" element={<LobbyJoinPage/>}/><Route path="/auth/verify" element={<AuthVerifyPage/>}/><Route path="/auth/callback" element={<AuthCallbackPage/>}/><Route path="*" element={<main id="main-content"><h1>Fixture return destination</h1></main>}/></Routes>}
 </AppearanceProvider></AuthContext.Provider>;
}
const initial=kind.startsWith("public")?"/team-room/example-share":kind.startsWith("lobby")?"/lobby/SAMPLE":kind.startsWith("verify")?"/auth/verify"+(kind==="verify-success"?"?success=1":kind==="verify-error"?"?error=expired":""):kind==="callback-safe"?"/auth/callback?token=example-fixture-token&next=%2Faccount":kind==="callback-unsafe"?"/auth/callback?token=example-fixture-token&next=https%3A%2F%2Fexample.invalid":"/";
createRoot(document.getElementById("root")).render(<MemoryRouter initialEntries={[initial]}><Supporting/></MemoryRouter>);
