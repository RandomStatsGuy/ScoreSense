// Development-only fixture. Production build includes only index.html.
import React from 'react';
import { createRoot } from 'react-dom/client';
import LeagueRostersBrowser from '../src/DraftHub/LeagueRostersBrowser';
import '../src/styles.css';
import '../src/styles/product-hierarchy.css';
import '../src/styles/product-rhythm.css';
import '../src/styles/fantasy-phone.css';
const values = [['Matthew Stafford', 'QB', 'LA', 'Colby L', 1, 37], ['Saquon Barkley', 'RB', 'PHI', 'Colby L', 37, 13], ['Baker Mayfield', 'QB', 'TB', 'Colby L', 4, 18], ['Dak Prescott', 'QB', 'DAL', 'Andrew M', 1, 14], ['Christian McCaffrey', 'RB', 'SF', 'Stephen P', 37, 26], ['Lamar Jackson', 'QB', 'BAL', 'Stephen P', 1, 12], ['Tony Pollard', 'RB', 'TEN', 'Nick F', 1, 10], ['Kyler Murray', 'QB', 'ARI', 'Andrew M', 1, 10], ['Mark Andrews', 'TE', 'BAL', 'Colby L', 3, 12], ['Hunter Henry', 'TE', 'NE', 'Colby L', 1, 8], ['T.J. Hockenson', 'TE', 'MIN', 'Colby L', 1, 7], ['Courtland Sutton', 'WR', 'DEN', 'Justin P', 14, 9], ['Patrick Mahomes', 'QB', 'KC', 'Colby L', 11, 14], ['Aaron Jones', 'RB', 'MIN', 'Josh C', 11, 10], ['Davante Adams', 'WR', 'LA', 'Chris G', 10, 11], ['Josh Allen', 'QB', 'BUF', 'Caleb K', 10, 15]];
const blocks = Object.entries(Object.groupBy(values, r => r[3])).map(([name, players]) => ({
  team: {
    id: name,
    owner_name: name,
    name: `${name}'s team`
  },
  stats: {
    unspent: 65,
    dead_cap: 3
  },
  roster: players.map(r => ({
    player_id: r[0],
    player_name: r[0],
    position: r[1],
    team: r[2],
    salary: r[4],
    fair_value: r[5],
    value_delta: r[4] - r[5],
    contract_grade: r[4] > r[5] ? 'bad' : 'good',
    years_remaining: 1,
    contract_type: 'veteran'
  }))
}));
window.__fixtures = {
  teams: blocks
};
window.__requests = [];
const realFetch = window.fetch.bind(window);
window.fetch = async (url, opts) => {
  const path = String(url);
  if (!path.startsWith('/api/')) return realFetch(url, opts);
  window.__requests.push(path);
  if (path.includes('/rosters')) {
    if (window.__delay) await new Promise(r => setTimeout(r, window.__delay));
    if (window.__failure) return new Response(JSON.stringify({
      detail: 'Could not load rosters'
    }), {
      status: 500
    });
    return Response.json(window.__empty ? {
      teams: []
    } : window.__fixtures);
  }
  return Response.json({
    media: {}
  });
};
function Preview() {
  const [league, setLeague] = React.useState('fixture');
  const [locked, setLocked] = React.useState(false);
  window.__setLeague = setLeague;
  window.__setLocked = setLocked;
  return <><div style={{
      padding: '16px 24px',
      borderBottom: '1px solid var(--border)',
      display: 'flex',
      gap: 32,
      alignItems: 'center'
    }}><strong style={{
        fontSize: 22
      }}>ScoreSense</strong><span>Projections</span><strong>Fantasy</strong><span>Tools</span></div><div className="qa-nav" style={{
      padding: '16px 24px',
      display: 'flex',
      gap: 24,
      borderBottom: '1px solid var(--border)',
      overflowX: 'auto'
    }}>{['Home', 'Strategy', 'Draft', 'This Week', 'Vibes', 'Game center', 'My team', 'Free agents', 'Rosters', 'Cap', 'Trades', 'Rules'].map(n => <span key={n} style={{
        whiteSpace: 'nowrap',
        color: n === 'Rosters' ? 'var(--accent-muted)' : 'var(--text-secondary)'
      }}>{n}</span>)}</div><LeagueRostersBrowser leagueId={league} hubContext={{
      team_id: 'Caleb K',
      acquisition_window: locked ? {
        trade_scope: 'surviving_contracts'
      } : null
    }} onNavigateTrade={() => {
      window.__trade = true;
    }} onOpenContractHistory={payload => {
      window.__history = payload;
    }} /></>;
}
createRoot(document.getElementById('root')).render(<Preview />);
