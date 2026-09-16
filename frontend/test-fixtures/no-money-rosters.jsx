// Development-only component fixture; all league writes stay in this page's memory.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import RosterBuilder from '../src/DraftHub/RosterBuilder';
import LeagueOffice from '../src/DraftHub/LeagueOffice';
import { capabilitiesFromRules } from '../src/DraftHub/leagueCapabilities';
import '../src/styles.css';
import '../src/styles/fantasy.css';
import '../src/styles/product-hierarchy.css';
import '../src/styles/product-rhythm.css';
import '../src/styles/fantasy-phone.css';
const params = new URLSearchParams(location.search);
const rules = { draft_type: params.get('draft') || 'snake', salary_cap: 200, contracts: { max_years: 3 } };
const context = {
  mode: 'league', league_id: 'fixture', team_id: 'alpha', team_name: 'Alex',
  is_commissioner: !params.has('readonly'), draft_completed: params.has('completed'),
  capabilities: capabilitiesFromRules(rules),
};
const initialRoster = [
  { id: 1, player_id: 'allen', player_name: 'Josh Allen', position: 'QB', team: 'BUF', salary: 250,
    contract: { years_remaining: 0, contract_type: 'veteran' }, roster_status: 'active' },
  { id: 2, player_id: 'jefferson', player_name: 'Justin Jefferson', position: 'WR', team: 'MIN', salary: 35,
    contract: { years_remaining: 2, contract_type: 'rookie' }, roster_status: 'active',
    ...(params.has('sleeper') ? { source: 'sleeper', sleeper_player_id: '4984' } : {}) },
];
let roster = params.has('empty') ? [] : initialRoster;
let notifyChange = () => {};
window.__requests = [];
window.__failWrite = false;
const realFetch = window.fetch.bind(window);
window.fetch = async (input, opts = {}) => {
  const url = String(input);
  if (!url.startsWith('/api/')) return realFetch(input, opts);
  window.__requests.push({ url, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
  if (url.includes('/rosters')) {
    if (params.has('loading')) await new Promise(resolve => setTimeout(resolve, 1000));
    if (params.has('error')) return Response.json({ detail: 'Roster unavailable. Try again.' }, { status: 500 });
    return Response.json({ salary_cap: 200, league: { rules }, teams: [
      { team: { id: 'alpha', name: 'Alex', owner_name: 'Alex', ...(params.has('sleeper') ? { sleeper_roster_id: 1 } : {}) }, roster },
      { team: { id: 'beta', name: 'Blair', owner_name: 'Blair' }, roster: [] },
    ] });
  }
  if (url.includes('/suggest?')) return Response.json({ suggestions: [
    { player_id: 'chase', player_name: "Ja'Marr Chase", position: 'WR', team: 'CIN' },
  ] });
  if (url === '/api/hub/roster' && ['DELETE', 'POST'].includes(opts.method)) {
    if (window.__failWrite) return Response.json({ detail: 'Roster update failed. Try again.' }, { status: 500 });
    const body = JSON.parse(opts.body);
    if (opts.method === 'DELETE') roster = roster.filter(row => row.player_id !== body.player_id);
    else roster = [...roster, { ...body, id: 3, contract: { years_remaining: 1 } }];
    notifyChange();
    return Response.json({ ok: true });
  }
  return Response.json({ media: {}, players: [] });
};
function Preview() {
  const [, render] = React.useReducer(n => n + 1, 0);
  notifyChange = render;
  return params.get('surface') === 'office'
    ? <LeagueOffice leagueId="fixture" officeTab="rosters" workspace={{ season: 2026, rules }} hubContext={context} onChanged={render} />
    : <RosterBuilder roster={roster} valueRows={[]} workspace={{ season: 2026, rules }} hubContext={context} focusFilter="all" onChanged={render} onNavigate={() => {}} />;
}
createRoot(document.getElementById('root')).render(<BrowserRouter><Preview /></BrowserRouter>);
