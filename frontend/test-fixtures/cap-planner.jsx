import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import CapPlanner from "../src/DraftHub/CapPlanner";
import { LeagueChromeProvider } from "../src/DraftHub/LeagueChromeContext";
import MobileHeader from "../src/layout/MobileHeader";
import MobileShell from "../src/layout/MobileShell";
import DesktopPrimaryHeader from "../src/layout/DesktopPrimaryHeader";
import HubSubnav from "../src/DraftHub/HubSubnav.jsx";
import LeagueContextBanner from "../src/DraftHub/LeagueContextBanner";
import useMobileLayout from "../src/useMobileLayout";
import { TeamIdentityProvider } from "../src/DraftHub/TeamIdentityContext";
import "../src/styles.css";
import "../src/styles/fantasy.css";
import "../src/styles/product-hierarchy.css";
import "../src/styles/product-rhythm.css";
import "../src/styles/fantasy-phone.css";
import "../src/styles/color-theme.css";
import "../src/styles/fantasy-header.css";
import fixture from "./cap-planner-data.json";
const params = new URLSearchParams(location.search),
  state = params.get('state') || 'ready';
const my = fixture.teams[0],
  rules = fixture.rules;
const context = {
  mode: 'league',
  league_id: 'fixture',
  team_id: state === 'readonly' ? '' : 'mine',
  team_name: 'Sunday Roster',
  league_name: params.has('long') ? 'The Extremely Long Fantasy Football League Name' : 'Bottom to Top',
  draft_completed: !params.has('pre'),
  capabilities: {
    uses_salaries: state !== 'pick'
  },
  rules
};
window.fixtureWrites = [];
window.fetch = async (input, options = {}) => {
  const path = String(input);
  if (options.method && options.method !== 'GET') {
    window.fixtureWrites.push({
      path,
      body: options.body
    });
    return Response.json({});
  }
  if (path.includes('cap-plans')) {
    if (state === 'loading') await new Promise(() => {});
    if (state === 'error') return Response.json({
      detail: 'Could not load team caps'
    }, {
      status: 503
    });
    return Response.json({
      teams: state === 'empty' ? [] : fixture.teams
    });
  }
  if (path.includes('identities')) return Response.json({
    identities: Object.fromEntries(fixture.teams.map(t => [t.team.id, t.team.identity]))
  });
  return Response.json({});
};
function Preview() {
  const [picker, setPicker] = useState(false),
    mobile = useMobileLayout();
  const nav = view => {
    window.fixtureNavigation = view;
  };
  return <LeagueChromeProvider><MobileShell className="app--compact-league" section="hub" onSectionChange={nav} onMoreOpen={() => {}} hrefForSection={id => '#' + id}>
 <header className="app-header app-header--hub app-header--product app-header--compact-league"><div className="app-header-shell app-header-shell--hub"><MobileHeader title="Cap" hasMenu compactLeague menuOpen={picker} onTitleClick={() => setPicker(true)} onMoreOpen={() => {}} /><DesktopPrimaryHeader productName="ScoreSense" studioName="4th Down Labs" sections={[{
            id: 'projections',
            label: 'Projections'
          }, {
            id: 'hub',
            label: 'Fantasy'
          }, {
            id: 'tools',
            label: 'Tools'
          }]} view="hub" onNavigate={nav} pathForSection={id => '#' + id} /><HubSubnav subView="planner" hubContext={context} onNavigate={nav} mobileLayout={mobile} pickerOnly={mobile} pickerOpen={picker} onPickerOpenChange={setPicker} /></div></header>
 <main id="main-content"><div className="draft-hub"><TeamIdentityProvider leagueId="fixture"><LeagueContextBanner hubContext={context} memberships={[{
              league_id: 'fixture',
              league_name: context.league_name,
              team: my.team
            }]} currentView="planner" showAttention={false} onLeagueSwitch={() => {}} /><CapPlanner capSheet={state === 'no-data' ? null : my.cap_sheet} roster={my.cap_sheet.planning_rows} workspace={{
              rules,
              season: 2026
            }} hubContext={context} onChanged={() => {
              window.fixtureChanged = true;
            }} onNavigate={nav} onOpenContractHistory={data => {
              window.fixtureHistory = data;
            }} /></TeamIdentityProvider></div></main>
 </MobileShell></LeagueChromeProvider>;
}
createRoot(document.getElementById('root')).render(<MemoryRouter><Preview /></MemoryRouter>);
