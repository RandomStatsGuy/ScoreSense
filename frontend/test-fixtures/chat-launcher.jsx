// Shared production chat/chrome with synthetic page content and isolated APIs.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import MobileShell from "../src/layout/MobileShell";
import ChatLauncher from "../src/DraftHub/ChatLauncher";
import CommunicationPanel, { NotificationBell } from "../src/DraftHub/CommunicationPanel";
import { CommunicationProvider } from "../src/DraftHub/CommunicationContext";
import "../src/styles.css";
import "../src/styles/fantasy.css";
import "../src/styles/product-hierarchy.css";
import "../src/styles/product-rhythm.css";
import "../src/styles/fantasy-phone.css";
import "../src/styles/trade-desk.css";
import "../src/styles/vibe-rankings.css";
import "../src/styles/color-theme.css";
import "../src/styles/fantasy-chat.css";

const query = new URLSearchParams(location.search);
document.documentElement.dataset.theme = query.get("theme") || "dark";
window.fixtureWrites = [];
window.fixtureUnread = 3;
const fetchAsset = window.fetch.bind(window);
window.fetch = async (input, options = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url, location.origin);
  if (!url.pathname.startsWith("/api/")) return fetchAsset(input, options);
  if ((options.method || "GET") !== "GET") window.fixtureWrites.push(url.pathname);
  if (url.pathname.endsWith("/chat/summary")) return Response.json({ members:[], threads:[], notifications:window.fixtureAlert?[window.fixtureAlert]:[], unread:window.fixtureUnread, preferences:{trade:true,direct:true,mention:true,league:false} });
  return Response.json({ messages:[], preferences:{trade:true,direct:true,mention:true,league:false} });
};

function Preview() {
  const [league, setLeague] = useState("anchor-fixture");
  const [page, setPage] = useState(1);
  const [bar, setBar] = useState("");
  const [large, setLarge] = useState(false);
  const [hidden, setHidden] = useState(false);
  const context = {mode:"league",league_id:league,team_id:"mine",league_name:"Fixture league"};
  return <CommunicationProvider enabled identity="chat-anchor-fixture" hubContext={context}>
    <MobileShell section="hub" onSectionChange={()=>{}} onMoreOpen={()=>{}} hrefForSection={id=>`#${id}`}>
      <header className="app-header" style={{padding:"var(--space-4)",display:"flex",justifyContent:"space-between"}}><strong>Fantasy fixture</strong><NotificationBell/></header>
      <main id="main-content" style={{padding:"var(--space-4)"}}>
        <h1>Chat position</h1>
        <div style={{display:"flex",flexWrap:"wrap",gap:"var(--space-2)"}}>
          <button className="btn-ghost" onClick={()=>setPage(page===1?2:1)}>Change matchup</button>
          <button className="btn-ghost" onClick={()=>setLeague(league==="anchor-fixture"?"other-fixture":"anchor-fixture")}>Switch fixture league</button>
          <button className="btn-ghost" onClick={()=>setHidden(!hidden)}>Toggle Home</button>
          <button className="btn-ghost" onClick={()=>setLarge(!large)}>Grow actions</button>
          {[["rules","Rules"],["contracts","Contracts"],["trades","Trades"],["","None"]].map(([value,label])=><button key={label} className="btn-ghost" onClick={()=>setBar(value)}>{label} actions</button>)}
        </div>
        <div style={{display:"grid",gap:"var(--space-3)",marginBlock:"var(--space-5)"}}>
          {Array.from({length:30},(_,i)=><button className="btn-ghost" key={i} style={{minHeight:"var(--control-h-lg)",textAlign:"right"}} data-page-row>{page===1?`Matchup ${i+1}`:`A much longer matchup name ${i+1} · Preview scores and team details`}</button>)}
        </div>
        {bar && <div data-bottom-actions className={{rules:"hub-rules-sticky-save",contracts:"hub-office-pending-tray",trades:"hub-trade-desk-bar"}[bar]} style={{minHeight:large?"152px":"80px"}}>
          <span>{large?"Several pending changes with a longer explanation for your team":"Pending changes"}</span><button className="btn-ghost">Review changes</button>
        </div>}
        <button className="btn-ghost" data-fixture-tail>Last page action</button>
      </main>
      <ChatLauncher leagueId={league} hidden={hidden}/><CommunicationPanel/>
    </MobileShell>
  </CommunicationProvider>;
}
createRoot(document.getElementById("root")).render(<MemoryRouter><Preview/></MemoryRouter>);
