// Development-only fixture using the production header components and mocked API.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import DesktopPrimaryHeader from '../src/layout/DesktopPrimaryHeader';
import MobileHeader from '../src/layout/MobileHeader';
import UserMenu from '../src/layout/UserMenu';
import HubSubnav, { HUB_SUBVIEWS } from '../src/DraftHub/HubSubnav';
import LeagueContextBanner from '../src/DraftHub/LeagueContextBanner';
import useMobileLayout from '../src/useMobileLayout';
import '../src/styles.css';
import '../src/styles/product-hierarchy.css';
import '../src/styles/product-rhythm.css';
import '../src/styles/fantasy-phone.css';
import '../src/styles/fantasy-header.css';
window.__requests = [];
const fetchOriginal = window.fetch.bind(window);
window.fetch = (url, options) => {
  if (!String(url).startsWith('/api/')) return fetchOriginal(url, options);
  window.__requests.push({ url, method: options?.method || 'GET' });
  return Promise.resolve(Response.json({ sleeper: { linked: true }, projections: { available: true } }));
};
function Preview() {
  const [context, setContext] = useState({ mode: 'league', league_id: 'fixture', league_name: 'Bottom to Top: Dominate Your Panda', team_id: 'caleb', team_name: 'Immaculate Concepcion', is_commissioner: true, draft_completed: true, sleeper_league_id: '123' });
  const [view, setView] = useState('rosters');
  const [product, setProduct] = useState('hub');
  const [open, setOpen] = useState(false);
  const mobile = useMobileLayout();
  window.__setContext = patch => setContext(current => ({ ...current, ...patch }));
  window.__setView = setView;
  window.__destinations = HUB_SUBVIEWS;
  const title = HUB_SUBVIEWS.find(item => item.id === view)?.label;
  const memberships = [{ league_id: 'fixture', league_name: context.league_name, team: { name: context.team_name }, is_commissioner: true }, { league_id: 'second', league_name: 'Sunday league', team: { name: 'Second team' } }];
  return <div className="app"><header className={`app-header ${product === 'hub' ? 'app-header--hub' : ''}`}><div className="app-header-shell">
    <DesktopPrimaryHeader productName="ScoreSense" studioName="4th Down Labs" sections={[{ id: 'projections', label: 'Projections' }, { id: 'hub', label: 'Fantasy' }, { id: 'tools', label: 'Tools' }]} view={product} pathForSection={id => `/${id}`} onNavigate={setProduct}><UserMenu authReady authenticated user={{ name: 'Kheylub' }} view={product} /></DesktopPrimaryHeader>
    {mobile && <MobileHeader title={title} hasMenu menuOpen={open} onTitleClick={() => setOpen(true)} />}
    <HubSubnav subView={view} hubContext={context} onNavigate={setView} mobileLayout={mobile} pickerOnly={mobile} pickerOpen={open} onPickerOpenChange={setOpen} />
  </div></header><main id="main-content"><div className="draft-hub"><LeagueContextBanner hubContext={context} memberships={memberships} onLeagueSwitch={choice => { window.__switched = choice; }} onCreateLeague={() => { window.__created = true; }} onLeagueSync={() => { window.__synced = true; }} showAttention={false} currentView={view} /><section style={{ padding: '32px 12px' }}><h1>{title === 'Rosters' ? 'League rosters' : title}</h1><p>Compare salaries, contract years, and estimated player values across teams.</p></section></div></main></div>;
}
createRoot(document.getElementById('root')).render(<Preview />);
