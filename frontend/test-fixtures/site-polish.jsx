// Isolated production components: every request stays in fixture memory.
import React, {useState} from "react";
import {createRoot} from "react-dom/client";
import {MemoryRouter} from "react-router-dom";
import VibeRankings from "../src/DraftHub/VibeRankings";
import {DEMO_VIBE_SLATE} from "../src/DraftHub/vibeRankingsPresentation";
import {DfsInputUpdate} from "../src/DfsWorkflow";
import "../src/styles.css";
import "../src/styles/fantasy.css";
import "../src/styles/product-hierarchy.css";
import "../src/styles/product-rhythm.css";
import "../src/styles/fantasy-phone.css";
import "../src/styles/color-theme.css";
import "../src/styles/dfs-workspace.css";

const params = new URLSearchParams(location.search);
window.fixtureWrites = [];
const context = {mode:"solo",team_id:"mine",season:2026,rules:{}};
window.fetch = async (input, options={}) => {
  if(options.method && options.method !== "GET") {
    window.fixtureWrites.push(String(input));
    return Response.json({});
  }
  if(String(input).includes("/api/hub/week")) return Response.json({
    meta:{season:2026,week:6,lineup_source:"hub"},hub_context:context,
    roster:{starters:params.has("empty")?[]:DEMO_VIBE_SLATE.slice(0,6),bench:[]}
  });
  return Response.json({media:{},players:[],teams:{}});
};
const diff = {fromVersion:1,toVersion:2,metadataChanged:true,changes:Array.from({length:12},(_,i)=>({
  id:String(i),name:i ? `Player ${i+1}` : "Alexandria Montgomery-Sutherland",
  kind:"changed",fields:["Projected Points"],before:{"Projected Points":12+i},after:{"Projected Points":14+i}
}))};
function InputReview(){
  const [update,setUpdate]=useState({diff}),[history,setHistory]=useState(null);
  const b={poolUpdate:update,poolUpdateHistory:history,canUndoPoolUpdate:Boolean(history),busy:false,building:false,
    applyPoolUpdate:()=>{setHistory(diff);setUpdate(null);},
    dismissPoolUpdate:()=>setUpdate(null),
    undoPoolUpdate:()=>setHistory({...diff,undoneAt:"2026-10-14T17:00:00Z"})};
  return <div className="dfw"><DfsInputUpdate b={b}/></div>;
}
createRoot(document.getElementById("root")).render(<MemoryRouter><div className="app"><main id="main-content"><div className="draft-hub">
  {params.get("page")==="update"?<InputReview/>:<VibeRankings hubContext={context} cacheScope="polish-fixture" onNavigate={view=>{window.fixtureDestination=view;}}/>}
</div></main></div></MemoryRouter>);
