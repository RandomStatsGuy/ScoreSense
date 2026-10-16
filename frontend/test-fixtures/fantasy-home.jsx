// Production Home, isolated API responses, and no real league writes.
import React from "react";
import { createRoot } from "react-dom/client";
import LeagueHome from "../src/DraftHub/LeagueHome";
import { TeamIdentityProvider } from "../src/DraftHub/TeamIdentityContext";
import "../src/styles.css";
import "../src/styles/fantasy.css";
import "../src/styles/product-hierarchy.css";
import "../src/styles/product-rhythm.css";
import "../src/styles/fantasy-phone.css";
import "../src/styles/color-theme.css";
import "../src/styles/fantasy-chat.css";
import "../src/styles/appearance.css";


import {context} from "./fantasy-home-data.js";
function Preview() {
  return <><div style={{padding:16,color:"var(--text-secondary)",fontSize:12}}>Home B / Matchup A · Sample data</div><a className="app-skip-link" href="#main-content">Skip to content</a><main id="main-content" className="app"><div className="draft-hub">
    <TeamIdentityProvider leagueId={context.league_id}><LeagueHome hubContext={context} onNavigate={(view,extra)=>window.fixtureActions.push({view,extra})} /></TeamIdentityProvider>
  </div></main></>;
}
createRoot(document.getElementById('root')).render(<Preview />);
