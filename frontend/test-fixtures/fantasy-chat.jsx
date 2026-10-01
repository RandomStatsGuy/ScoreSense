// Production chat component; the browser check supplies isolated message fixtures.
import React from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter} from 'react-router-dom';
import {CommunicationProvider} from '../src/DraftHub/CommunicationContext';
import LeagueChat from '../src/DraftHub/LeagueChat';
import '../src/styles.css';
import '../src/styles/fantasy.css';
import '../src/styles/product-hierarchy.css';
import '../src/styles/product-rhythm.css';
import '../src/styles/fantasy-phone.css';
import '../src/styles/color-theme.css';
import '../src/styles/fantasy-chat.css';

const query=new URLSearchParams(location.search);
const context={mode:'league',league_id:'review-league',team_id:query.get('team'),is_commissioner:false,is_primary_commissioner:false};
createRoot(document.getElementById('root')).render(<BrowserRouter><CommunicationProvider enabled identity="review" hubContext={context}>
  <main id="main-content" style={{maxWidth:640,margin:'auto',padding:'var(--space-4)'}}><LeagueChat leagueId={context.league_id} hubContext={context} compact={query.has('compact')}/></main>
</CommunicationProvider></BrowserRouter>);
