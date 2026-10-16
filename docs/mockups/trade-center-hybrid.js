/* Static review fixtures and interactions. No API calls or persisted league state. */
const $ = (selector) => document.querySelector(selector);
const all = (selector) => [...document.querySelectorAll(selector)];
const esc = (value) => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const player = (id, name, pos, salary, years, kind, week) => ({id, name, pos, salary, years, kind, week});
const mine = [
  player('cook','James Cook','RB',18,1,'Vet deal',14.8),
  player('hall','Breece Hall','RB',32,2,'Vet deal',17.2),
  player('achane','De’Von Achane','RB',29,2,'Vet deal',19.4),
  player('warren','Jaylen Warren','RB',5,1,'Vet deal',8.6),
  player('jefferson','Justin Jefferson','WR',36,3,'Extension',21.2),
  player('flowers','Zay Flowers','WR',10,1,'Rookie deal',12.8),
  player('mcbride','Trey McBride','TE',12,2,'Extension',13.9),
  player('hurts','Jalen Hurts','QB',25,2,'Vet deal',22.1),
  player('purdy','Brock Purdy','QB',4,1,'Vet deal',18.1),
  player('ferguson','Jake Ferguson','TE',6,1,'Vet deal',10.8),
  player('kicker1','Kicker','K',1,1,'Vet deal',8.2),
  player('defense1','Team defense','DEF',1,1,'Vet deal',7.4),
];
const jordan = [
  player('wilson','Garrett Wilson','WR',24,2,'Extension',17.3),
  player('collins','Nico Collins','WR',22,3,'Vet deal',18.4),
  player('nacua','Puka Nacua','WR',28,2,'Vet deal',19.1),
  player('higgins','Tee Higgins','WR',16,2,'Vet deal',15.6),
  player('stevenson','Rhamondre Stevenson','RB',14,1,'Vet deal',12.4),
  player('kincaid','Dalton Kincaid','TE',8,2,'Rookie deal',9.8),
  player('reed','Jayden Reed','WR',8,1,'Vet deal',12.2),
  player('odunze','Rome Odunze','WR',7,2,'Rookie deal',11.9),
  player('burrow','Joe Burrow','QB',22,2,'Vet deal',21.0),
  player('nix','Bo Nix','QB',10,1,'Vet deal',17.5),
  player('freiermuth','Pat Freiermuth','TE',4,1,'Vet deal',7.1),
  player('kicker2','Kicker','K',1,1,'Vet deal',8),
  player('defense2','Team defense','DEF',1,1,'Vet deal',7),
];
const alex = [
  player('london','Drake London','WR',24,2,'Vet deal',16.5),
  player('smith','DeVonta Smith','WR',20,2,'Vet deal',14.5),
  player('brown','A.J. Brown','WR',32,2,'Vet deal',19.2),
  player('metcalf','DK Metcalf','WR',18,1,'Vet deal',14),
  player('pacheco','Isiah Pacheco','RB',16,1,'Vet deal',12),
  player('bowers','Brock Bowers','TE',16,2,'Rookie deal',14.6),
  player('murray','Kyler Murray','QB',18,2,'Vet deal',20),
  player('dobbins','J.K. Dobbins','RB',6,1,'Vet deal',9),
  player('meyers','Jakobi Meyers','WR',6,1,'Vet deal',10),
  player('kicker3','Kicker','K',1,1,'Vet deal',8),
  player('defense3','Team defense','DEF',1,1,'Vet deal',7),
];
const managers = {
  jordan:{name:'Jordan Davis', team:'Fourth & Goal', initials:'JD', rows:jordan, dead:4},
  alex:{name:'Alex Rivera', team:'Sunday Club', initials:'AR', rows:alex, dead:2},
};
const state = {tab:'build', stage:'build', partner:'jordan', send:new Set(['cook']), receive:new Set(['wilson']), query:'', pos:'All', phone:'send', expanded:{send:false,receive:false}, salary:true, linked:true, missing:false, offseason:false, blocked:false, noPartners:false, note:'', inbox:'pending', proposed:null};
const sum = (rows, key) => rows.reduce((total,p) => total+p[key],0);
const money = n => n < 0 ? `−$${Math.abs(n)}` : `$${n}`;
const chosen = side => (side === 'send' ? mine : (managers[state.partner]?.rows || [])).filter(p => state[side].has(p.id));
const currentPartner = () => managers[state.partner];
const hasPackage = () => Boolean(state.partner && (state.send.size || state.receive.size) && !state.noPartners);
const knownWeek = () => !state.missing && !state.offseason;
const cap = () => state.blocked ? 185 : 200;
const weekText = value => knownWeek() ? value.toFixed(1) : '—';
function afterRows() { return mine.filter(p => !state.send.has(p.id)).concat(chosen('receive')); }
function afterPartnerRows() { return (currentPartner()?.rows || []).filter(p => !state.receive.has(p.id)).concat(chosen('send')); }
function weekTotal(rows) {
  const pool = rows.slice().sort((a,b) => b.week-a.week);
  let total=0;
  for(const allowed of [['QB'],['RB'],['RB'],['WR'],['WR'],['TE'],['RB','WR','TE'],['K'],['DEF']]) {
    const index=pool.findIndex(p => allowed.includes(p.pos));
    if(index>=0) total+=pool.splice(index,1)[0].week;
  }
  return Math.round(total*10)/10;
}
function metrics() {
  const partner=currentPartner();
  const before=sum(mine,'salary'), next=sum(afterRows(),'salary');
  const theirBefore=sum(partner?.rows || [],'salary'), theirNext=sum(afterPartnerRows(),'salary');
  const beforeWeek=weekTotal(mine), afterWeek=weekTotal(afterRows());
  const myCount=afterRows().length, theirCount=afterPartnerRows().length;
  const myRoom=cap()-next-6, theirRoom=cap()-theirNext-(partner?.dead || 0);
  const capInvalid=state.salary && (myRoom<0 || theirRoom<0);
  const rosterInvalid=myCount>18 || theirCount>18 || myCount<9 || theirCount<9;
  const windowInvalid=state.offseason&&state.salary&&[...chosen('send'),...chosen('receive')].some(p=>p.years===1);
  return {before,next,theirBefore,theirNext,myRoom,theirRoom,beforeWeek,afterWeek,delta:Math.round((afterWeek-beforeWeek)*10)/10,myCount,theirCount,invalid:capInvalid||rosterInvalid||windowInvalid,capInvalid,rosterInvalid,windowInvalid};
}
function count(rows,pos) { return rows.filter(p => p.pos===pos).length; }
function announce(text) { $('#trade-announcement').textContent=text; }
function searchMarkup(id,placeholder) { return `<label class="search-field"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="6" stroke="currentColor" stroke-width="1.8"/><path d="m15 15 5 5" stroke="currentColor" stroke-width="1.8"/></svg><input id="${id}" type="search" aria-label="${placeholder}" placeholder="${placeholder}" value="${esc(state.query)}"></label>`; }
function playerRow(p,side) {
  const selected=state[side].has(p.id), eligible=Boolean(state.partner && !state.noPartners) && !(state.offseason && state.salary && p.years===1);
  const action=side==='send' ? `Send ${p.name} to ${currentPartner()?.name || 'a partner'}` : `Receive ${p.name} from ${currentPartner()?.name || 'a partner'}`;
  const contract=state.salary ? `${p.years}y · ${p.kind}` : 'PPR projection';
  return `<li class="player-row${selected?' is-selected':''}" data-player="${p.id}"><span class="player-mark" aria-hidden="true">${p.pos}</span><div class="player-info"><strong>${p.name}</strong><small>${contract}</small></div><div class="player-data"><strong>${weekText(p.week)}<span class="sr-only"> projected week points</span></strong><small>${state.salary?money(p.salary):p.pos}</small></div><button class="pick-player" data-player-toggle="${p.id}" data-side="${side}" aria-label="${esc(action)}" aria-pressed="${selected}" ${eligible?'':'disabled'} title="${eligible?(selected?'Remove from package':'Add to package'):state.offseason?'Offseason trades require a surviving contract':'Choose a partner first'}">${selected?'✓':'+'}</button></li>`;
}
function rosterPanel(side) {
  const yours=side==='send', partner=currentPartner(), rows=yours?mine:partner?.rows || [];
  const filtered=rows.filter(p => (state.pos==='All'||state.pos===p.pos) && `${p.name} ${p.pos}`.toLowerCase().includes(state.query.toLowerCase()));
  const visible=state.expanded[side]||state.query||state.pos!=='All'?filtered:filtered.slice(0,7);
  return `<section class="roster-panel" data-side="${side}" aria-label="${yours?'You send':'You receive'}"><header class="roster-header"><div class="roster-direction"><h2>${yours?'You send':'You receive'}</h2><span class="quiet-badge">${state[side].size} selected</span></div><div class="manager-line"><span class="owner-avatar">${yours?'MC':partner?.initials||'—'}</span><div class="manager-identity"><strong>${yours?'Maya Chen · You':partner?.name||'Choose a partner'}</strong><small>${yours?'Sunday Best':partner?.team||'Compare rosters and build a package'}</small></div>${yours?'':`<button class="partner-change" data-action="partner" aria-label="${partner?'Change':'Choose'} trade partner">${partner?'Change':'Choose'}</button>`}</div></header><div class="roster-column-key"><span>Player${state.salary?' / contract':''}</span><span>${state.offseason?'Week unavailable':'Week P50'}${state.salary?' / salary':''}</span></div><ul class="player-list">${visible.map(p=>playerRow(p,side)).join('') || `<li class="empty-roster">${rows.length?'No players match your filters.':'Choose a trade partner to see their roster.'}</li>`}</ul><footer class="roster-footer"><span class="meta">${rows.length} rostered</span>${rows.length?`<button data-expand="${side}">${state.expanded[side]?'Show fewer':`View all ${rows.length}`} <span aria-hidden="true">⌄</span></button>`:''}</footer></section>`;
}
function capBlock(yours,m) {
  const before=yours?m.before:m.theirBefore, next=yours?m.next:m.theirNext, dead=yours?6:currentPartner()?.dead || 0;
  const room=cap()-next-dead, oldRoom=cap()-before-dead;
  const row=(label,old,nextValue,cls='')=>`<div class="${cls}"><dt>${label}</dt><dd><span>${money(old)} →</span> <strong class="${nextValue<0?'down':''}">${money(nextValue)}</strong></dd></div>`;
  return `<p class="impact-owner">${yours?'Maya Chen · You':currentPartner()?.name || 'Partner'} <span class="meta">· ${money(cap())} cap</span></p><dl class="cap-dl">${row('Current roster salary',before,next)}${row('Existing dead cap',dead,dead)}${row('Against cap',before+dead,next+dead)}${row('Cap room',oldRoom,room,'cap-room')}</dl><div class="cap-track" aria-hidden="true"><span style="width:${Math.min(100,next/cap()*100)}%"></span><i style="width:${dead/cap()*100}%"></i></div>`;
}
function depthMarkup() {
  return ['RB','WR','TE'].map(pos=>`<span>${pos} ${count(mine,pos)} → <strong>${count(afterRows(),pos)}</strong></span>`).join('');
}
function impactRail() {
  const m=metrics(), partner=currentPartner();
  let body=hasPackage() ? `${state.salary?capBlock(true,m):`<p class="impact-owner">Maya Chen · You</p><dl class="cap-dl"><div><dt>Roster space</dt><dd>${mine.length} → ${m.myCount} / 18</dd></div></dl>`}<div class="week-impact"><p class="eyebrow">This Week · Your starters</p>${knownWeek()?`<div class="week-value"><strong class="${m.delta<0?'down':'up'}">${m.delta>0?'+':''}${m.delta.toFixed(1)}<span class="sr-only"> projected week points</span></strong><span>${m.beforeWeek.toFixed(1)} → ${m.afterWeek.toFixed(1)}</span></div><p>Best projected lineup · PPR P50</p>`:`<p>${state.offseason?'Week lineups return in-season.':'Week projections are unavailable.'}</p>`}</div><div class="depth-change">${depthMarkup()}</div><details class="impact-disclosure"><summary>Why this works for you</summary><p>${count(afterRows(),'WR')>count(mine,'WR')?'You add a receiver to a roster with only two WRs.':'Compare the incoming players with your current starters.'} ${count(afterRows(),'RB')<count(mine,'RB')?`RB depth drops from ${count(mine,'RB')} to ${count(afterRows(),'RB')}.`:''}</p></details><details class="impact-disclosure"><summary>${partner?.name || 'Partner'}’s side</summary>${state.salary?capBlock(false,m):`<p>Roster: ${partner?.rows.length || 0} → ${m.theirCount} / 18</p>`}<p>${count(afterPartnerRows(),'RB')>count(partner?.rows || [],'RB')?'An incoming RB fills out their starting options.':'Review their positional depth after the exchange.'} WR depth: ${count(partner?.rows || [],'WR')} → ${count(afterPartnerRows(),'WR')}.</p></details>${state.salary?`<details class="impact-disclosure"><summary>Contract terms</summary>${chosen('receive').map(p=>`<p>${p.name}: ${money(p.salary)} current salary · ${p.years}y remaining · ${p.kind}.</p>`).join('') || '<p>No incoming contracts.</p>'}<p>Future-year cap schedule unavailable.</p></details>`:''}<div class="availability"><span>Rest-of-season impact</span><strong>—</strong></div><p class="meta">Package outlook not available yet.</p>` : `<div class="empty-impact"><span class="empty-symbol" aria-hidden="true">⇄</span><strong>See what changes.</strong><p>Select players to compare your starters, ${state.salary?'cap room, and ':''}roster depth.</p></div>${state.salary?capBlock(true,m):`<p class="meta">${mine.length} of 18 roster spots used</p>`}`;
  return `<aside class="impact-rail" aria-label="Live trade impact"><div class="rail-heading"><h2>Trade impact</h2><span class="live-label">Live preview</span></div>${body}</aside>`;
}
function phoneViews() { return `<nav class="phone-views" aria-label="Builder view">${[['send','Send',state.send.size],['receive','Receive',state.receive.size],['impact','Impact','']].map(([id,label,n])=>`<button data-phone="${id}" aria-pressed="${state.phone===id}">${label}${n!==''?` (${n})`:''}</button>`).join('')}</nav>`; }
function builder() {
  return `${phoneViews()}<div class="builder-layout" data-phone-view="${state.phone}"><div class="builder-main"><div class="builder-toolbar">${searchMarkup('player-search','Search both rosters…')}<div class="position-filters" aria-label="Player position">${['All','QB','RB','WR','TE'].map(pos=>`<button data-pos="${pos}" aria-pressed="${state.pos===pos}">${pos}</button>`).join('')}</div></div><div class="roster-pair" id="roster-pair">${rosterPanel('send')}${rosterPanel('receive')}</div><div class="builder-foot"><button class="advanced-button" data-action="advanced"><span aria-hidden="true">⊕</span> Advanced terms</button><span class="meta">${knownWeek()?'PPR estimates · Week 6':'Week projections unavailable'}</span></div><div class="strategy-note"><span class="strategy-icon" aria-hidden="true">⇄</span><div><strong>Use your depth to fill a gap.</strong><p>${state.partner?'You have extra RBs. Compare your partner’s WR depth.':'Discover managers with complementary roster needs.'}</p></div><button class="text-link" data-tab="ideas">See idea →</button></div></div>${impactRail()}</div>`;
}
function reviewPlayer(p) { return `<div class="review-player"><span class="player-mark">${p.pos}</span><div class="player-info"><strong>${p.name}</strong><small>${state.salary?`${p.years}y · ${p.kind}`:'PPR projection'}</small></div><div class="player-data"><strong>${state.salary?money(p.salary):p.pos}</strong><small>${weekText(p.week)} week pts</small></div></div>`; }
function checks() {
  const m=metrics();
  return `<div class="review-checks"><h3>League requirements</h3>${state.salary?`<div class="check-row${m.capInvalid?' is-blocked':''}"><span>${m.capInvalid?'!':'✓'}</span><span>${m.capInvalid?`Cap limit exceeded. Your cap room would be ${money(m.myRoom)}; ${currentPartner().name}’s would be ${money(m.theirRoom)}.`:`Both teams under the ${money(cap())} cap, including dead cap`}</span></div>`:''}<div class="check-row${m.rosterInvalid?' is-blocked':''}"><span>${m.rosterInvalid?'!':'✓'}</span><span>Roster sizes: you ${m.myCount}/18 · ${currentPartner().name} ${m.theirCount}/18${m.rosterInvalid?' · outside 9–18 limits':''}</span></div><div class="check-row"><span>✓</span><span>Selected players belong to the sending teams</span></div><div class="check-row${m.windowInvalid?' is-blocked':''}"><span>${m.windowInvalid?'!':'✓'}</span><span>${m.windowInvalid?'Expiring contracts cannot trade offseason':'Player moves allowed in this sample league'}</span></div></div>`;
}
function review() {
  return `<div class="review-heading"><h2>Review this trade</h2><button class="text-link" data-action="edit">← Edit package</button></div><div class="builder-layout review-layout"><section class="review-package" aria-label="Trade review"><div class="review-leg"><p class="eyebrow">You send → ${currentPartner().name}</p>${chosen('send').map(reviewPlayer).join('') || '<p class="meta">No outgoing players</p>'}</div><div class="review-leg"><p class="eyebrow">You receive ← ${currentPartner().name}</p>${chosen('receive').map(reviewPlayer).join('') || '<p class="meta">No incoming players</p>'}</div>${state.salary?'<p class="review-explanation">No cuts or existing dead-cap transfers. Current salaries and remaining contract terms move with the players.</p>':''}${checks()}<label class="proposal-note">Note to ${currentPartner().name} (optional)<textarea id="proposal-note" placeholder="Why this works, or what you’d consider in return.">${esc(state.note)}</textarea></label><div class="next-steps"><h3>After you propose</h3><ol><li>${currentPartner().name} sees the proposal in Inbox and can accept or reject.</li>${state.linked?'<li>Every team accepts here; complete the player trade in Sleeper.</li><li>Use Sync league. ScoreSense confirms the destinations before applying agreed cap terms.</li>':'<li>Every team must accept before ScoreSense moves the players and any agreed terms.</li>'}</ol><p class="linked-note">${state.linked?'<strong>Player moves happen in Sleeper.</strong> Your private weekly lineup preview is not shared with your partner.':'You can cancel from Inbox until the trade executes.'}</p></div></section>${impactRail()}</div>`;
}
function discovery() {
  return `<div class="discovery-heading"><div><h2>Find a trade partner</h2><p class="meta">Roster needs and depth · no acceptance predictions</p></div>${searchMarkup('manager-search','Search managers…')}</div><div class="discovery-grid" id="discovery-grid">${discoveryCards()}</div>`;
}
function discoveryCards() {
  if(state.noPartners) return '<section class="discovery-card"><p>No other managers in this league yet.</p><button class="btn btn-ghost" data-preview="Roster management · Members">Invite managers</button></section>';
  return Object.entries(managers).filter(([,p])=>`${p.name} ${p.team}`.toLowerCase().includes(state.query.toLowerCase())).map(([id,p])=>`<section class="discovery-card"><div class="manager-line"><span class="owner-avatar">${p.initials}</span><div class="manager-identity"><strong>${p.name}</strong><small>${p.team}</small></div></div><p>${count(p.rows,'RB')<2?'<span class="need-chip">Needs RB</span>':'RB starters covered'} · ${count(p.rows,'WR')} WRs</p><p class="meta">${state.salary?`${money(cap()-sum(p.rows,'salary')-p.dead)} cap room · `:''}${p.rows.length}/18 rostered</p><p>${id==='jordan'?'Their WR depth complements your extra RBs.':'Compare their receivers with your starting options.'}</p><button class="btn btn-ghost" data-pick-partner="${id}">Build with ${p.name.split(' ')[0]} →</button></section>`).join('') || '<p class="muted">No managers match your search.</p>';
}
function ideas() {
  if(state.noPartners) return '<section class="inbox-card"><h2>No suggested trades</h2><p>Invite managers to find trade partners.</p></section>';
  return `<section class="ideas-section"><h2>Turn depth into a starting option.</h2><p class="meta">Suggested package · your RB depth meets Jordan’s need at RB</p><article class="idea-card"><div><p class="eyebrow">You send</p><h3>James Cook <span class="meta">RB${state.salary?' · $18':''}</span></h3><p>You keep Hall and Achane at RB. Wilson adds a third WR.</p></div><div><p class="eyebrow">You receive</p><h3>Garrett Wilson <span class="meta">WR${state.salary?' · $24':''}</span></h3><p>Jordan fills an open RB starting slot and keeps five WRs.</p></div><button class="btn btn-ghost" data-action="load-idea">Load into builder →</button></article></section>`;
}
function inbox() {
  const pending=state.inbox==='pending', sent=state.proposed;
  return `<section class="inbox-card"><p class="eyebrow">${sent?'Your proposal':'Incoming proposal'} · ${sent?esc(sent.partner):'Jordan Davis'}</p><h2>${sent?esc(sent.names):'James Cook ↔ Garrett Wilson'}</h2><span class="inbox-status">${sent?'Waiting for acceptances':pending?'Waiting for your response':state.inbox==='accepted'?(state.linked?'Accepted · Waiting for Sleeper':'All accepted · Trade executed'):'Proposal declined'}</span><p>${state.linked?'Accepted cap terms wait for the player move in Sleeper and matching synced destinations.':'Every team must accept before players and agreed terms move.'}</p>${!pending&&!sent&&state.inbox==='accepted'&&state.linked?'<p class="meta">After Sync league, a synced player move also receives a separate cap review. Review or confirm no dead-cap terms.</p>':''}<div class="inbox-actions">${sent?'<button class="btn btn-ghost" data-action="cancel-proposal">Cancel proposal</button>':pending?'<button class="btn btn-ghost" data-action="review-inbox">Review proposal</button><button class="btn btn-ghost" data-action="accept">Accept terms</button><button class="btn btn-ghost" data-action="decline">Decline</button>':'<button class="btn btn-ghost" data-action="reset-inbox">Reset preview</button>'}</div></section>`;
}
function renderBar() {
  const bar=$('#package-bar'), m=metrics(), has=hasPackage();
  bar.hidden=state.tab!=='build';
  const text=state.noPartners?'Invite another manager to trade.':!state.partner?'Choose a partner to get started.':!has?'Add a player to build your package.':m.invalid?(m.capInvalid?'Cap limit exceeded · edit package':m.windowInvalid?'Expiring contract cannot trade offseason':'Roster limit exceeded · edit package'):'✓ Cap and roster limits pass';
  const verdict=state.salary?text:text.replace('Cap and roster','Roster');
  bar.innerHTML=`<div class="package-overview"><div class="package-leg"><small>You send${state.salary&&state.send.size?` · ${money(sum(chosen('send'),'salary'))}`:''}</small><strong title="${esc(chosen('send').map(p=>p.name).join(', '))}">${esc(chosen('send').map(p=>p.name).join(', '))||'Select players'}</strong></div><span class="package-exchange" aria-hidden="true">⇄</span><div class="package-leg"><small>You receive${state.salary&&state.receive.size?` · ${money(sum(chosen('receive'),'salary'))}`:''}</small><strong title="${esc(chosen('receive').map(p=>p.name).join(', '))}">${esc(chosen('receive').map(p=>p.name).join(', '))||'Select players'}</strong></div></div><div class="package-verdict ${m.invalid&&has?'is-blocked':!has?'is-idle':''}" role="status" aria-live="polite">${verdict}</div><button class="btn btn-primary" data-action="${state.noPartners?'invite':!state.partner?'partner':state.stage==='review'?'propose':'review'}" ${state.noPartners||!state.partner?'':!has||m.invalid?'disabled':''}>${state.noPartners?'Invite managers':!state.partner?'Choose partner':state.stage==='review'?'Propose trade':'Review trade'} <span aria-hidden="true">→</span></button>`;
}
function render() {
  if(state.noPartners) { state.partner=null; state.send.clear(); state.receive.clear(); }
  all('[data-tab]').forEach(b=>{if(b.dataset.tab===state.tab)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
  $('#league-context').textContent=`2026 · PPR${state.salary?` · ${money(cap())} cap`:''} · ${state.linked?'Sleeper linked':'ScoreSense league'}`;
  $('#hero-support').textContent=state.salary?'Check both teams’ cap and roster limits before you propose.':'Check starting options and roster limits before you propose.';
  $('#hero-status').textContent=state.noPartners?'No trade partners yet':state.partner?`Trading with ${currentPartner().name}`:'Choose a trade partner';
  $('.status-dot').style.background=state.partner?'var(--tone-positive)':'var(--text-muted)';
  $('#trade-content').innerHTML=state.tab==='build'?(state.stage==='review'&&hasPackage()?review():builder()):state.tab==='discover'?discovery():state.tab==='ideas'?ideas():inbox();
  all('.workspace-tabs [data-tab]').forEach(b=>{if(b.dataset.tab===state.tab)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
  renderBar();
}
function setScenario(stage) {
  state.tab='build';state.stage=stage==='review'?'review':'build';state.partner=stage==='initial'?null:'jordan';
  state.send=new Set(stage==='initial'?[]:['cook']);state.receive=new Set(stage==='initial'?[]:['wilson']);state.query='';state.pos='All';state.phone='send';
  state.noPartners=false;$('#no-partners').checked=false;
  all('[data-state]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.state===stage)));
  render();
}
let lastDialogTrigger;
function openDialog(title,body) {
  lastDialogTrigger=document.activeElement;
  $('#dialog-body').innerHTML=`<div class="dialog-heading"><h2 id="dialog-title">${title}</h2><button data-action="close-dialog" aria-label="Close dialog">×</button></div>${body}`;
  $('#trade-dialog').showModal();
}
$('#trade-dialog').addEventListener('close',()=>lastDialogTrigger?.isConnected&&lastDialogTrigger.focus());
function partnerDialog() {
  openDialog('Choose a trade partner',Object.entries(managers).map(([id,p])=>`<div class="dialog-manager"><span class="owner-avatar">${p.initials}</span><div><strong>${p.name}</strong><p>${count(p.rows,'WR')} WRs · ${count(p.rows,'RB')<2?'thin at RB':'RB starters covered'}${state.salary?` · ${money(cap()-sum(p.rows,'salary')-p.dead)} cap room`:''}</p></div><button class="btn btn-ghost" data-pick-partner="${id}">Choose</button></div>`).join('')+'<p class="meta">Changing partners clears the current package.</p>');
}
function advancedDialog() {
  openDialog('Advanced terms',`<p class="muted">These entries preview where the existing advanced workflows belong.</p><details class="advanced-detail"><summary>Multi-team trade</summary><p>Add up to two more partners. Each player needs a named receiving team.</p><button class="btn btn-ghost" data-preview="Multi-team editor · explicit player recipients">Add a team</button></details><details class="advanced-detail"><summary>${state.salary?'Cuts and dead cap':'Drops for roster space'}</summary><p>${state.salary?'A cut opens roster space and assigns its current-season dead cap. Review who takes that obligation.':'A drop opens roster space.'}</p><button class="btn btn-ghost" data-preview="Advanced package · player selection">Choose a player</button></details>${state.salary?'<details class="advanced-detail"><summary>Existing dead-cap transfers</summary><p>Move an existing obligation without moving a player. Preserve the source player, original team, season, and history.</p><dl class="cap-dl"><div><dt>Sample obligation · Maya · 2026</dt><dd>$6</dd></div></dl><button class="btn btn-ghost" data-preview="Dead-cap editor · source history and receiving team">Review obligation</button></details>':''}<p class="meta">Advanced editors are structural previews; the two-team builder is interactive.</p>`);
}
document.addEventListener('click',event=>{
  const button=event.target.closest('button'); if(!button||button.disabled)return;
  if(button.dataset.state) {setScenario(button.dataset.state);return;}
  if(button.dataset.tab) {state.tab=button.dataset.tab;state.query='';render();return;}
  if(button.dataset.phone) {state.phone=button.dataset.phone;render();return;}
  if(button.dataset.pos) {state.pos=button.dataset.pos;render();return;}
  if(button.dataset.expand) {state.expanded[button.dataset.expand]=!state.expanded[button.dataset.expand];render();return;}
  if(button.dataset.playerToggle) {
    const side=button.dataset.side,id=button.dataset.playerToggle;
    if(state[side].has(id))state[side].delete(id);else state[side].add(id);
    all('[data-state]').forEach(b=>b.setAttribute('aria-pressed','false'));
    render();const replacement=$(`[data-player-toggle="${id}"]`);replacement?.focus({preventScroll:true});
    announce('Package updated. '+(metrics().invalid?'Edit package to meet league limits.':'Trade impact updated.'));return;
  }
  if(button.dataset.pickPartner) {
    state.partner=button.dataset.pickPartner;state.send.clear();state.receive.clear();state.stage='build';state.tab='build';state.phone='send';state.query='';
    $('#trade-dialog').close();render();$('#player-search')?.focus({preventScroll:true});return;
  }
  const action=button.dataset.action;
  if(action==='partner')partnerDialog();
  if(action==='advanced')advancedDialog();
  if(action==='close-dialog')$('#trade-dialog').close();
  if(action==='review'&&hasPackage()&&!metrics().invalid) {state.stage='review';render();$('.review-heading').setAttribute('tabindex','-1');$('.review-heading').focus();}
  if(action==='edit') {state.stage='build';state.phone='send';render();$('#player-search')?.focus({preventScroll:true});}
  if(action==='load-idea'||action==='review-inbox') {setScenario(action==='review-inbox'?'review':'populated');announce('Suggested package loaded into builder.');}
  if(action==='invite')openDialog('Invite managers','<p class="muted">Invite another manager from Roster management · Members.</p><button class="btn btn-ghost" data-preview="Roster management · Members">Open Members →</button>');
  if(action==='accept')openDialog('Accept these terms?',`<p class="muted">James Cook → Jordan Davis<br>Garrett Wilson → Maya Chen</p><p class="muted">${state.linked?'Complete the player trade in Sleeper, then sync the league. Accepted terms alone do not move players.':'Both acceptances complete the trade in this sample native league.'}</p><p class="meta">Preview only · no proposal is sent or accepted.</p><button class="btn btn-ghost" data-action="confirm-accept">Preview acceptance</button>`);
  if(action==='confirm-accept') {state.inbox='accepted';$('#trade-dialog').close();render();announce('Acceptance preview updated.');}
  if(action==='decline') {state.inbox='declined';render();}
  if(action==='reset-inbox') {state.inbox='pending';render();}
  if(action==='cancel-proposal') {state.proposed=null;render();}
  if(action==='propose'&&hasPackage()&&!metrics().invalid) {
    state.proposed={partner:currentPartner().name,names:`${chosen('send').map(p=>p.name).join(', ')||'No outgoing players'} ↔ ${chosen('receive').map(p=>p.name).join(', ')||'No incoming players'}`};state.tab='inbox';render();announce('Preview proposal created. No league changes.');
  }
});
document.addEventListener('input',event=>{
  if(event.target.id==='player-search') {state.query=event.target.value;$('#roster-pair').innerHTML=rosterPanel('send')+rosterPanel('receive');}
  if(event.target.id==='manager-search') {state.query=event.target.value;$('#discovery-grid').innerHTML=discoveryCards();}
  if(event.target.id==='proposal-note')state.note=event.target.value;
});
document.addEventListener('change',event=>{
  const keys={'salary-format':'salary','sleeper-host':'linked','missing-projections':'missing','offseason':'offseason','blocked-package':'blocked','no-partners':'noPartners'};
  if(!keys[event.target.id])return;
  state[keys[event.target.id]]=event.target.checked;
  if(state.offseason&&state.salary) {
    for(const side of ['send','receive'])for(const p of chosen(side))if(p.years===1)state[side].delete(p.id);
  }
  if(!state.noPartners&&!state.partner)state.partner='jordan';
  if(state.stage==='review'&&!hasPackage())state.stage='build';
  render();announce('Preview scenario updated.');
});
document.addEventListener('keydown',event=>{if(event.key==='Escape')all('details.preview-options[open]').forEach(d=>d.open=false);});
const params=new URLSearchParams(location.search);
setScenario(['initial','review'].includes(params.get('state'))?params.get('state'):'populated');
