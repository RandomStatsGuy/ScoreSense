import React from "react";
import {createRoot} from "react-dom/client";
import {BrowserRouter} from "react-router-dom";
import App from "../src/App";
import {AuthContext} from "../src/AuthContext";
import {AppearanceProvider} from "../src/AppearanceProvider";
import "../src/styles.css";
import "../src/styles/product-hierarchy.css";
import "../src/styles/product-rhythm.css";
import "../src/styles/projections-experience.css";
import "../src/styles/fantasy-phone.css";
import "../src/styles/color-theme.css";
import "../src/styles/fantasy-header.css";
let revision="2026-10-06T01:00:00Z",points=20.2;
window.fixtureRequests=[];
window.fixturePublish=()=>{revision="2026-10-06T02:00:00Z";points=24.4;};
window.fixtureFail=false;
const row=()=>({player_id:"00-0036389",Player:"Josh Allen",Team:"BUF",Position:"QB",Season:2026,Week:4,Age:30,
 "Projected Points":points,"Low (P10)":12.2,"High (P90)":30.2,"Season Proj":points*17,"Per-Game Proj":points,
 "Low (Season)":200,"High (Season)":450,"P50":points,"ROS P50":points*10,"ROS Proj":points*10});
window.fetch=async(url,options={})=>{
 const path=String(url);window.fixtureRequests.push({path,method:options.method || "GET"});
 if (path.includes("/api/refresh/status")) return Response.json({status:"never_run",automatic:{last_success_at:revision,health:window.fixtureFail ? {"weekly:2026:4":{needs_attention:true,refresh_state:"failed"},"draft:2026":{needs_attention:true,refresh_state:"failed"},"ros:2026:4":{needs_attention:true,refresh_state:"failed"}} : {}}});
 if(path.includes("/api/meta/")) return Response.json({default_season:2026,default_week:4,upcoming_season:2026,seasons:[2026],teams:["BUF"],weeks_by_season:{"2026":[4]},is_offseason:false,preseason_mode:false});
 if(path.includes("/api/predict/") && path.includes("changes"))return Response.json({changes:[]});
 if(path.includes("/api/predict/") || path.includes("/api/draft/") || path.includes("/api/ros/"))return Response.json({position:"qb",projections:[row()],meta:{season:2026,week:4,from_week:4,projection_week:4,weeks_remaining:10,projection_built_at:revision,projection_refresh:{needs_attention:false,refresh_state:"scheduled"}}});
 if(path.includes("/api/players/context"))return Response.json({players:[],meta:{stale:false,available:true,updated_at:revision,built_at:revision}});
 if(path.includes("injuries"))return Response.json({players:[]});
 if(path.includes("preferences"))return Response.json({preferences:{}});
 return Response.json({});
};
const auth={ready:true,authenticated:true,user:{sub:"fixture",name:"Tessa"},hubAuthRequired:false,authRequired:false,
hubDemo:{available:false},openSignIn:()=>{},closeSignIn:()=>{},logout:()=>{},refreshAuth:async()=>{}};
createRoot(document.getElementById("root")).render(<BrowserRouter><AuthContext.Provider value={auth}><AppearanceProvider><App/></AppearanceProvider></AuthContext.Provider></BrowserRouter>);
