/* Trade flow improvements: three directions layered on the approved October 15 A desk fixture.
   Static review only. No API calls, no persisted league state. */
const flow = document.body.dataset.flow;
const you = {name:'Maya Chen', team:'Sunday Best', initials:'MC'};
const initials = name => name.split(/\s+/).map(w => (w.replace(/[^A-Za-z]/g,'')[0] || '')).join('').slice(0,2).toUpperCase();
const face = (p, size='') => `<span class="face ${size}" data-pos="${p.pos}" aria-hidden="true">${initials(p.name)}</span>`;
const signed = n => `${n > 0 ? '+' : ''}${n.toFixed(1)}`;
const partnerFirst = () => currentPartner()?.name.split(' ')[0] || 'partner';
const roomBefore = () => cap() - sum(mine,'salary') - 6;
const theirRoomBefore = () => currentPartner() ? cap() - sum(currentPartner().rows,'salary') - currentPartner().dead : 0;
let openGroups = {send:new Set(['QB','RB','WR','TE']), receive:new Set(['QB','RB','WR','TE'])};

function lineupShift() {
  const before = plan(mine), after = plan(afterRows());
  const entering = after.filter(s => s.player && !before.some(b => b.player?.id === s.player.id));
  const leaving = before.filter(s => s.player && !after.some(a => a.player?.id === s.player.id));
  const moved = after.filter((s,i) => s.player && before[i].player?.id !== s.player.id && before.some(b => b.player?.id === s.player.id));
  return {entering, leaving, moved};
}
function headline() {
  const m = metrics();
  if (state.noPartners) return 'Invite another manager to trade.';
  if (!state.partner) return 'Choose a partner to get started.';
  if (!hasPackage()) return 'Add a player to see what changes.';
  if (state.salary && m.myRoom < 0) return `Needs ${money(-m.myRoom)} more cap room`;
  if (m.rosterInvalid) return 'Roster limit exceeded';
  if (m.windowInvalid) return 'Expiring contracts cannot trade offseason';
  const shift = lineupShift();
  if (knownWeek() && shift.entering.length) {
    const [first, ...rest] = shift.entering;
    return `${first.player.name}${rest.length ? ` + ${rest.length}` : ''} enter${rest.length ? '' : 's'} your projected starters`;
  }
  if (knownWeek() && shift.leaving.length) return `Moves ${shift.leaving[0].player.name} out of your starters`;
  if (state.salary) {
    const d = m.myRoom - roomBefore();
    if (Math.abs(d) >= 1) return d > 0 ? `Frees ${money(d)} in cap room` : `Uses ${money(-d)} of cap room`;
  }
  return 'Changes your roster mix';
}
function shiftDetail() {
  if (!hasPackage() || !knownWeek()) return '';
  const shift = lineupShift();
  const parts = [];
  shift.entering.forEach(s => parts.push(`${s.player.name} starts at ${s.slot}`));
  shift.moved.forEach(s => parts.push(`${s.player.name} moves to ${s.slot}`));
  shift.leaving.forEach(s => parts.push(`${s.player.name} leaves ${s.slot}`));
  return parts.length ? parts.join(' · ') + '.' : 'No projected starter changes.';
}
function figures() {
  const m = metrics(), partner = currentPartner();
  const list = [];
  const weekOk = knownWeek() && hasPackage();
  list.push({label:'Your starters · Week 6', value: weekOk ? signed(m.delta) : '—', unit: weekOk ? 'pts' : '', note: weekOk ? `${m.beforeWeek.toFixed(1)} → ${m.afterWeek.toFixed(1)} · PPR P50` : state.offseason ? 'Available in-season' : state.missing ? 'Forecast unavailable' : 'Choose players to compare', tone: weekOk ? (m.delta < 0 ? 'down' : m.delta > 0 ? 'up' : '') : ''});
  if (state.salary) {
    list.push({label:'Your cap room', value: money(m.myRoom), note:`${money(roomBefore())} before · ${money(cap())} cap`, tone: m.myRoom < 0 ? 'blocking' : ''});
    list.push({label:`${partner ? partnerFirst() : 'Partner'} cap room`, value: partner ? money(m.theirRoom) : '—', note: partner ? partner.name : 'Choose a partner', tone: m.theirRoom < 0 ? 'blocking' : ''});
  } else {
    list.push({label:'Your roster', value:`${m.myCount}`, unit:'/ 18', note:`${mine.length} before trade`});
    list.push({label:`${partner ? partnerFirst() : 'Partner'} roster`, value: partner ? `${m.theirCount}` : '—', unit: partner ? '/ 18' : '', note: partner ? partner.name : 'Choose a partner'});
  }
  return list;
}
function figureMarkup(f, cls='') {
  return `<div class="figure ${cls}"><span class="figure-label">${f.label}</span><strong class="${f.tone}">${f.value}${f.unit ? `<small> ${f.unit}</small>` : ''}</strong><span class="figure-note">${f.note}</span></div>`;
}
function verdictText() {
  const m = metrics(), has = hasPackage();
  const text = state.noPartners ? 'Invite another manager to trade.' : !state.partner ? 'Choose a partner to get started.' : !has ? 'Add a player to build your package.' : m.invalid ? (m.capInvalid ? 'Cap limit exceeded · edit package' : m.windowInvalid ? 'Expiring contract cannot trade offseason' : 'Roster limit exceeded · edit package') : '✓ Cap and roster limits pass';
  return state.salary ? text : text.replace('Cap and roster','Roster');
}
function verdictClass() { const m = metrics(), has = hasPackage(); return m.invalid && has ? 'is-blocked' : !has ? 'is-idle' : ''; }
function primaryButton() {
  const m = metrics(), has = hasPackage();
  const action = state.noPartners ? 'invite' : !state.partner ? 'partner' : state.stage === 'review' ? 'propose' : 'review';
  const label = state.noPartners ? 'Invite managers' : !state.partner ? 'Choose partner' : state.stage === 'review' ? 'Propose trade' : 'Review trade';
  const disabled = state.noPartners || !state.partner ? '' : (!has || m.invalid ? 'disabled' : '');
  return `<button class="btn btn-primary" data-action="${action}" ${disabled}>${label} <span aria-hidden="true">→</span></button>`;
}
function legTotal(side) {
  const rows = chosen(side);
  if (!rows.length) return '';
  const pts = rows.reduce((t,p) => t + p.week, 0);
  return `${state.salary ? `${money(sum(rows,'salary'))} · ` : ''}${knownWeek() ? `${pts.toFixed(1)} wk pts` : `${rows.length} player${rows.length === 1 ? '' : 's'}`}`;
}
function legChips(side) {
  const rows = chosen(side);
  if (!rows.length) return `<span class="deal-empty">${side === 'send' ? 'Pick from your roster' : `Pick from ${partnerFirst()}’s roster`}</span>`;
  return rows.map(p => `<span class="deal-chip">${face(p)}<span class="deal-chip-text"><strong>${p.name}</strong><small>${p.pos}${state.salary ? ` · ${money(p.salary)}` : ''}</small></span><button class="chip-remove" data-remove-player="${p.id}" data-remove-side="${side}" aria-label="Remove ${esc(p.name)} from package">×</button></span>`).join('');
}
function dealRow(p, {remove=true}={}) {
  return `<div class="deal-row">${face(p,'face-lg')}<div class="deal-row-text"><strong>${p.name}</strong><small>${p.pos}${state.salary ? ` · ${money(p.salary)} · ${p.years}y · ${p.kind}` : ' · PPR projection'}</small></div><div class="deal-row-data"><strong>${weekText(p.week)}</strong><small>wk pts</small></div>${remove ? `<button class="chip-remove" data-remove-player="${p.id}" data-remove-side="${p.side}" aria-label="Remove ${esc(p.name)} from package">×</button>` : ''}</div>`;
}
function sideRows(side) { return chosen(side).map(p => ({...p, side})); }
function withPackage(send, receive, fn) {
  const s = state.send, r = state.receive, p = state.partner;
  state.send = new Set(send); state.receive = new Set(receive); state.partner = 'jordan';
  try { return fn(); } finally { state.send = s; state.receive = r; state.partner = p; }
}
function afterPropose() {
  return `<section class="after-propose"><h3>After you propose</h3><ol><li>${currentPartner()?.name || 'Your partner'} sees it in Inbox and can accept or reject.</li>${state.linked ? '<li>Every team accepts here; complete the player trade in Sleeper, then Sync league. ScoreSense confirms the destinations before applying agreed cap terms.</li>' : '<li>Every team must accept before ScoreSense moves the players and any agreed terms.</li>'}</ol><p class="meta">You can cancel from Inbox until it executes. Your weekly lineup preview stays private.</p></section>`;
}
function noteField() {
  return `<label class="proposal-note">Note to ${currentPartner()?.name || 'partners'} (optional)<textarea id="proposal-note" placeholder="Why this works, or what you’d consider in return.">${esc(state.note)}</textarea></label>`;
}
function analysisDisclosures() {
  const m = metrics(), partner = currentPartner();
  return `<div class="analysis"><details class="impact-disclosure"><summary>Full impact · contract life, depth, points per dollar</summary><p>Remaining-season and contract-life estimates use cached forecasts. Skill positions use model projections; K and DEF use rank-curve estimates. Missing forecasts stay unavailable.</p><div class="depth-change">${depthMarkup()}</div></details><details class="impact-disclosure"><summary>${partner?.name || 'Partner'}’s side</summary>${state.salary ? capBlock(false,m) : `<p>Roster ${partner?.rows.length || 0} → ${m.theirCount} / 18</p>`}</details>${state.salary ? `<details class="impact-disclosure"><summary>Contract terms</summary>${chosen('receive').map(p => `<p>${p.name}: ${money(p.salary)} current salary · ${p.years}y remaining · ${p.kind}.</p>`).join('') || '<p>No incoming contracts.</p>'}<p>Future-year cap schedule unavailable.</p></details>` : ''}</div>`;
}

/* ---------- A · Deal card ---------- */
function headlineBand() {
  const m = metrics(), has = hasPackage(), weekOk = knownWeek() && has;
  const facts = [];
  if (weekOk) facts.push(`<li class="${m.delta < 0 ? 'down' : 'up'}">${signed(m.delta)} pts this week</li>`);
  if (has && state.salary) facts.push(`<li>Cap room ${money(roomBefore())} → <strong class="${m.myRoom < 0 ? 'blocking' : ''}">${money(m.myRoom)}</strong></li>`);
  if (has && state.salary && currentPartner()) facts.push(`<li>${partnerFirst()} ${money(theirRoomBefore())} → <strong class="${m.theirRoom < 0 ? 'blocking' : ''}">${money(m.theirRoom)}</strong></li>`);
  if (has && !state.salary) facts.push(`<li>Roster ${mine.length} → <strong>${m.myCount}</strong> / 18</li>`);
  return `<section class="deal-headline" aria-label="Package impact"><p class="deal-sentence">${headline()}</p>${facts.length ? `<ul class="deal-facts">${facts.join('')}</ul>` : ''}<button class="text-link" data-open-impact>Full impact ↗</button></section>`;
}
function dealCardBar() {
  const label = (text, side) => `<span class="deal-leg-label">${text}${legTotal(side) ? `<span class="leg-total"> · ${legTotal(side)}</span>` : ''}</span>`;
  return `<div class="deal-card deal-card-bar"><div class="deal-legs"><div class="deal-leg">${label('You send','send')}<div class="deal-chips">${legChips('send')}</div></div><span class="deal-swap" aria-hidden="true">⇄</span><div class="deal-leg">${label('You receive','receive')}<div class="deal-chips">${legChips('receive')}</div></div></div><div class="deal-verdict ${verdictClass()}" role="status" aria-live="polite">${verdictText()}</div>${primaryButton()}</div>`;
}
function dealCardLarge({sendRows, receiveRows, remove=true, partnerName}) {
  const partner = partnerName || currentPartner()?.name || 'Partner';
  return `<section class="deal-card deal-card-large" aria-label="Trade package"><div class="deal-col"><div class="deal-col-head"><p class="eyebrow">You send → ${partner}</p><span class="meta">${legTotal('send') || `${sendRows.length} players`}</span></div>${sendRows.map(p => dealRow(p,{remove})).join('') || '<p class="deal-empty">No outgoing players</p>'}</div><span class="deal-swap deal-swap-large" aria-hidden="true">⇄</span><div class="deal-col"><div class="deal-col-head"><p class="eyebrow">You receive ← ${partner}</p><span class="meta">${legTotal('receive') || `${receiveRows.length} players`}</span></div>${receiveRows.map(p => dealRow(p,{remove})).join('') || '<p class="deal-empty">No incoming players</p>'}</div></section>`;
}
function consequence(title='What changes for you') {
  return `<section class="consequence" aria-label="${title}"><div class="consequence-head"><h3>${title}</h3><span class="live-label">Live preview · private</span></div><div class="figure-row">${figures().map(f => figureMarkup(f)).join('')}</div><p class="consequence-line"><strong>${headline()}</strong>${shiftDetail() ? ` <span>${shiftDetail()}</span>` : ''}</p></section>`;
}
function flowABuilder() {
  return `<div class="desk-workspace" data-phone-view="${state.phone}">${headlineBand()}${phoneViews()}<div class="desk-main">${searchToolbar()}<div class="roster-pair" id="roster-pair">${rosterPanel('send')}${rosterPanel('receive')}</div><div class="builder-foot">${advancedLink()}<span class="meta">${knownWeek() ? 'Week 6 · PPR estimates' : 'Weekly estimates unavailable'}</span></div></div><div class="desk-phone-impact">${impactRail()}</div></div>`;
}
function flowAReview() {
  return `<div class="review-heading"><h2>Review this trade</h2><button class="text-link" data-action="edit">← Edit package</button></div>${dealCardLarge({sendRows:sideRows('send'), receiveRows:sideRows('receive'), remove:false})}${consequence()}<div class="review-grid">${noteField()}${afterPropose()}</div>${analysisDisclosures()}`;
}
function acceptanceChips(parties) {
  return `<ul class="accept-chips" aria-label="Acceptances">${parties.map(p => `<li class="${p.state}"><span class="owner-avatar">${p.initials}</span><span>${p.name}</span><small>${p.state === 'done' ? 'Accepted' : p.state === 'declined' ? 'Declined' : 'Waiting'}</small></li>`).join('')}</ul>`;
}
function inboxDealCard({from, to, sendRows, receiveRows, status, statusTone, meta, consequenceLine, actions, parties}) {
  return `<article class="deal-card deal-card-inbox"><header class="inbox-head"><div class="manager-line"><span class="owner-avatar">${from.initials}</span><div class="manager-identity"><strong>${from.name}${from.you ? ' · You' : ''} → ${to}</strong><small>${meta}</small></div></div><span class="inbox-status ${statusTone}">${status}</span></header><div class="deal-legs deal-legs-inbox"><div class="deal-leg"><span class="deal-leg-label">${from.you ? 'You send' : `${from.name.split(' ')[0]} sends you`}</span>${sendRows.map(p => dealRow(p,{remove:false})).join('') || '<p class="deal-empty">Nothing</p>'}</div><span class="deal-swap" aria-hidden="true">⇄</span><div class="deal-leg"><span class="deal-leg-label">${from.you ? 'You receive' : 'You send'}</span>${receiveRows.map(p => dealRow(p,{remove:false})).join('') || '<p class="deal-empty">Nothing</p>'}</div></div>${consequenceLine ? `<p class="consequence-line inbox-consequence">${consequenceLine}</p>` : ''}${parties ? acceptanceChips(parties) : ''}<div class="inbox-actions">${actions}</div></article>`;
}
function incomingConsequence() {
  return withPackage(['cook'],['wilson'], () => {
    const m = metrics();
    return `<strong>${headline()}</strong> <span>${knownWeek() ? `${signed(m.delta)} pts to your starters` : 'Weekly estimate unavailable'}${state.salary ? ` · cap room ${money(roomBefore())} → ${money(m.myRoom)}` : ` · roster ${m.myCount}/18`} · private to you</span>`;
  });
}
function flowAInbox() {
  const pending = state.inbox === 'pending', sent = state.proposed;
  const jordan = managers.jordan;
  const incoming = inboxDealCard({from:{name:'Jordan Davis', initials:'JD'}, to:'you', meta:'Fourth & Goal · proposed 2h ago', sendRows:jordan.rows.filter(p => p.id === 'wilson'), receiveRows:mine.filter(p => p.id === 'cook'), status: pending ? 'Waiting for your response' : state.inbox === 'accepted' ? (state.linked ? 'Accepted · waiting for Sleeper' : 'All accepted · executed') : 'Declined', statusTone: pending ? 'is-attention' : state.inbox === 'accepted' ? 'is-positive' : 'is-muted', consequenceLine: incomingConsequence(), parties:[{name:'Jordan', initials:'JD', state:'done'},{name:'You', initials:'MC', state: pending ? 'wait' : state.inbox === 'accepted' ? 'done' : 'declined'}], actions: pending ? '<button class="btn btn-ghost" data-action="review-inbox">Review in builder</button><button class="btn btn-ghost" data-action="accept">Accept terms</button><button class="text-link" data-action="decline">Decline</button>' : `${state.inbox === 'accepted' && state.linked ? '<p class="meta">After Sync league, the synced player move gets a separate cap review.</p>' : ''}<button class="btn btn-ghost" data-action="reset-inbox">Reset preview</button>`});
  const yours = sent ? inboxDealCard({from:{name:'Maya Chen', initials:'MC', you:true}, to:sent.partner, meta:'Your proposal · just now', sendRows:sideRows('send'), receiveRows:sideRows('receive'), status:'Waiting for acceptances', statusTone:'is-attention', parties:[{name:'You', initials:'MC', state:'done'},{name:sent.partner.split(' ')[0], initials:initials(sent.partner), state:'wait'}], actions:'<button class="btn btn-ghost" data-action="cancel-proposal">Cancel proposal</button>'}) : '';
  return `<div class="inbox-stack">${yours}${incoming}<section class="inbox-history"><h3>Earlier</h3><ul><li><span>Trey McBride ↔ Dalton Kincaid</span><span class="meta">Jordan Davis · declined · Sep 30</span></li><li><span>Jake Ferguson ↔ Jakobi Meyers</span><span class="meta">Alex Rivera · executed · Sep 18</span></li></ul></section></div>`;
}

/* ---------- B · Guided desk ---------- */
function stepRail() {
  const has = hasPackage(), partner = currentPartner(), m = metrics();
  const steps = [
    {label:'Partner', detail: state.noPartners ? 'No managers yet' : partner ? partner.name : 'Choose one', state: partner ? 'done' : 'current'},
    {label:'Players', detail: has ? `${state.send.size} out · ${state.receive.size} in` : partner ? 'Add a player' : '—', state: has ? 'done' : partner ? 'current' : ''},
    {label:'Review', detail: has ? (m.invalid ? 'Fix limits' : state.stage === 'review' ? 'Checking terms' : 'Ready') : '—', state: has && !m.invalid ? (state.stage === 'review' ? 'current' : 'next') : ''},
    {label:'Propose', detail:'Inbox for partners', state: state.stage === 'review' && has && !m.invalid ? 'next' : ''},
  ];
  const hint = state.noPartners ? 'Invite another manager to trade.' : !partner ? 'Next: choose a trade partner below.' : !has ? `Next: add a player from your roster or ${partnerFirst()}’s.` : m.invalid ? 'Fix the limit before you review.' : state.stage === 'review' ? 'Next: add a note, then propose.' : 'Next: review the package.';
  return `<section class="step-rail" aria-label="Trade steps"><ol>${steps.map((s,i) => `<li class="${s.state}" ${s.state === 'current' ? 'aria-current="step"' : ''}><span class="step-num">${s.state === 'done' ? '✓' : i + 1}</span><span class="step-text"><strong>${s.label}</strong><small>${s.detail}</small></span></li>`).join('')}</ol><p class="step-hint">${hint}</p></section>`;
}
function needsFor(rows, mineSide) {
  const slots = {QB:1, RB:2, WR:2, TE:1};
  const out = [];
  Object.entries(slots).forEach(([pos,n]) => { const c = count(rows,pos); if (c < n) out.push({pos, text:`Needs ${pos}`, tone:'need'}); else if (c >= n + 2) out.push({pos, text:`${pos} depth`, tone:'surplus'}); });
  return out;
}
function needChips(rows) {
  const items = needsFor(rows);
  return items.length ? `<div class="need-row">${items.map(i => `<span class="need-chip ${i.tone === 'surplus' ? 'is-surplus' : ''}">${i.text}</span>`).join('')}</div>` : '';
}
function partnerStrip() {
  if (state.noPartners) return '<section class="partner-strip"><p class="muted">No other managers in this league yet.</p><button class="btn btn-ghost" data-preview="Roster management · Members">Invite managers</button></section>';
  return `<section class="partner-strip" aria-label="Choose a trade partner"><div class="partner-strip-head"><h2>Who are you trading with?</h2><span class="meta">Needs and cap room from current rosters</span></div><div class="partner-cards">${Object.entries(managers).map(([id,p]) => `<article class="partner-card"><div class="manager-line"><span class="owner-avatar">${p.initials}</span><div class="manager-identity"><strong>${p.name}</strong><small>${p.team}</small></div></div>${needChips(p.rows)}<p class="meta">${state.salary ? `${money(cap() - sum(p.rows,'salary') - p.dead)} cap room · ` : ''}${p.rows.length}/18 rostered</p><p>${id === 'jordan' ? 'Their WR depth meets your extra RBs.' : 'Compare their receivers with your starters.'}</p><button class="btn btn-ghost" data-pick-partner="${id}">Build with ${p.name.split(' ')[0]} →</button></article>`).join('')}</div></section>`;
}
function partnerLine() {
  const p = currentPartner();
  return `<section class="partner-line" aria-label="Trade partner"><div class="manager-line"><span class="owner-avatar">${p.initials}</span><div class="manager-identity"><strong>Trading with ${p.name}</strong><small>${p.team}${state.salary ? ` · ${money(theirRoomBefore())} cap room` : ''} · ${p.rows.length}/18</small></div></div>${needChips(p.rows)}<button class="partner-change" data-action="partner" aria-label="Change trade partner">Change partner</button></section>`;
}
function groupedRosterPanel(side) {
  const yours = side === 'send', partner = currentPartner(), rows = yours ? mine : partner?.rows || [];
  const filtered = rows.filter(p => (state.pos === 'All' || state.pos === p.pos) && `${p.name} ${p.pos}`.toLowerCase().includes(state.query.toLowerCase()));
  const groups = ['QB','RB','WR','TE','K','DEF'].map(pos => ({pos, rows: filtered.filter(p => p.pos === pos)})).filter(g => g.rows.length);
  const slots = {QB:1, RB:2, WR:2, TE:1, K:1, DEF:1};
  const body = groups.map(g => { const open = openGroups[side].has(g.pos) || state.query || state.pos !== 'All'; const needText = count(rows,g.pos) < slots[g.pos] ? 'short' : count(rows,g.pos) >= slots[g.pos] + 2 ? 'deep' : ''; return `<li class="pos-group"><button class="pos-group-toggle" data-toggle-group="${g.pos}" data-group-side="${side}" aria-expanded="${open}"><span class="pos-group-name">${g.pos} <span class="meta">${count(rows,g.pos)} for ${slots[g.pos]} ${slots[g.pos] === 1 ? 'slot' : 'slots'}</span></span>${needText ? `<span class="need-chip ${needText === 'deep' ? 'is-surplus' : ''}">${needText === 'deep' ? 'Depth' : 'Needs ' + g.pos}</span>` : ''}<span class="group-caret" aria-hidden="true">${open ? '⌃' : '⌄'}</span></button>${open ? `<ul class="player-list">${g.rows.map(p => playerRow(p,side)).join('')}</ul>` : ''}</li>`; }).join('');
  return `<section class="roster-panel grouped" data-side="${side}" aria-label="${yours ? 'You send' : 'You receive'}"><header class="roster-header"><div class="roster-direction"><h2>${yours ? 'You send' : 'You receive'}</h2><span class="quiet-badge">${state[side].size} selected</span></div><div class="manager-line"><span class="owner-avatar">${yours ? you.initials : partner?.initials || '—'}</span><div class="manager-identity"><strong>${yours ? `${you.name} · You` : partner?.name || 'Choose a partner'}</strong><small>${yours ? you.team : partner?.team || 'Compare rosters and build a package'}</small></div></div></header><div class="roster-column-key"><span>Player${state.salary ? ' / contract' : ''}</span><span>${state.offseason ? 'Week unavailable' : 'Week P50'}${state.salary ? ' / salary' : ''}</span></div><ul class="group-list">${body || `<li class="empty-roster">${rows.length ? 'No players match your filters.' : 'Choose a trade partner to see their roster.'}</li>`}</ul></section>`;
}
function flowBBuilder() {
  return `<div class="desk-workspace guided" data-phone-view="${state.phone}">${stepRail()}${state.partner && !state.noPartners ? partnerLine() : partnerStrip()}${state.partner && !state.noPartners ? impactBand() : ''}${phoneViews()}<div class="desk-main">${searchToolbar()}<div class="roster-pair" id="roster-pair">${groupedRosterPanel('send')}${groupedRosterPanel('receive')}</div><div class="builder-foot">${advancedLink()}<span class="meta">${knownWeek() ? 'Week 6 · PPR estimates' : 'Weekly estimates unavailable'}</span></div></div><div class="desk-phone-impact">${impactRail()}</div></div>`;
}
function flowBReview() {
  const m = metrics(), partner = currentPartner();
  const item = (cls, mark, title, body, action='') => `<li class="${cls}"><span class="check-mark" aria-hidden="true">${mark}</span><div class="check-body"><strong>${title}</strong>${body}</div>${action}</li>`;
  return `${stepRail()}<div class="review-heading"><h2>Review this trade</h2><button class="text-link" data-action="edit">← Edit package</button></div><ol class="review-checklist">${item('is-done','✓','Players',`<p>${chosen('send').map(p => `${p.name} → ${partner.name}`).join(' · ') || 'No outgoing players'}<br>${chosen('receive').map(p => `${p.name} → you`).join(' · ') || 'No incoming players'}</p>`,'<button class="text-link" data-action="edit">Edit</button>')}${state.salary ? item(m.capInvalid ? 'is-blocked' : 'is-done', m.capInvalid ? '!' : '✓','Cap',`<p>You ${money(roomBefore())} → <strong class="${m.myRoom < 0 ? 'blocking' : ''}">${money(m.myRoom)}</strong> · ${partner.name.split(' ')[0]} ${money(theirRoomBefore())} → <strong class="${m.theirRoom < 0 ? 'blocking' : ''}">${money(m.theirRoom)}</strong>${m.capInvalid ? ' · over the cap' : ` · both under ${money(cap())}`}</p>`) : ''}${item(m.rosterInvalid ? 'is-blocked' : 'is-done', m.rosterInvalid ? '!' : '✓','Roster',`<p>You ${m.myCount}/18 · ${partner.name.split(' ')[0]} ${m.theirCount}/18${m.rosterInvalid ? ' · outside 9–18 limits' : ''}</p>`)}${item('is-info','◦','This week',`<p>${knownWeek() ? `<strong class="${m.delta < 0 ? 'down' : 'up'}">${signed(m.delta)} pts</strong> to your starters · ${m.beforeWeek.toFixed(1)} → ${m.afterWeek.toFixed(1)} · private` : state.offseason ? 'Weekly lineups return in-season.' : 'Weekly projections unavailable.'}${shiftDetail() ? `<br>${shiftDetail()}` : ''}</p>`,'<button class="text-link" data-open-impact>Full impact ↗</button>')}${item('is-open','5','Note',noteField())}${item('is-next','6','After you propose',`<p>${partner.name} sees it in Inbox. Nothing moves until every team involved accepts.${state.linked ? ' Then complete the player trade in Sleeper and Sync league; ScoreSense applies agreed cap terms after confirming destinations.' : ''}</p>`)}</ol>${analysisDisclosures()}`;
}
function timeline(steps) {
  return `<ol class="proposal-timeline" aria-label="Progress">${steps.map(s => `<li class="${s.state}"><span class="tl-dot" aria-hidden="true"></span><span>${s.label}</span></li>`).join('')}</ol>`;
}
function flowBInbox() {
  const pending = state.inbox === 'pending', sent = state.proposed;
  const incomingSteps = [{label:'Proposed', state:'done'}, {label:'Jordan', state:'done'}, {label:'You', state: pending ? 'current' : state.inbox === 'accepted' ? 'done' : 'declined'}, ...(state.linked ? [{label:'Sleeper', state: state.inbox === 'accepted' ? 'current' : ''}, {label:'Synced', state:''}] : [{label:'Executed', state: state.inbox === 'accepted' ? 'done' : ''}])];
  const row = ({who, when, what, line, steps, actions}) => `<li class="proposal-row"><div class="proposal-top"><div class="manager-line"><span class="owner-avatar">${who.initials}</span><div class="manager-identity"><strong>${who.name}</strong><small>${when}</small></div></div>${timeline(steps)}</div><p class="proposal-what">${what}</p>${line ? `<p class="consequence-line">${line}</p>` : ''}<div class="inbox-actions">${actions}</div></li>`;
  const incoming = row({who:{name:'Jordan Davis → you', initials:'JD'}, when:'Proposed 2h ago · Fourth & Goal', what:`<strong>Garrett Wilson</strong> for <strong>James Cook</strong>`, line: incomingConsequence(), steps: incomingSteps, actions: pending ? '<button class="btn btn-ghost" data-action="review-inbox">Review proposal</button><button class="btn btn-ghost" data-action="accept">Accept terms</button><button class="text-link" data-action="decline">Decline</button>' : '<button class="btn btn-ghost" data-action="reset-inbox">Reset preview</button>'});
  const yours = sent ? row({who:{name:`You → ${sent.partner}`, initials:'MC'}, when:'Proposed just now', what:`<strong>${chosen('send').map(p => p.name).join(', ') || 'Nothing'}</strong> for <strong>${chosen('receive').map(p => p.name).join(', ') || 'nothing'}</strong>`, steps:[{label:'Proposed', state:'done'}, {label:'You', state:'done'}, {label:sent.partner.split(' ')[0], state:'current'}, ...(state.linked ? [{label:'Sleeper', state:''}, {label:'Synced', state:''}] : [{label:'Executed', state:''}])], actions:'<button class="btn btn-ghost" data-action="cancel-proposal">Cancel proposal</button>'}) : '';
  return `<ul class="proposal-list">${yours}${incoming}<li class="proposal-row is-history"><div class="proposal-top"><div class="manager-line"><span class="owner-avatar">AR</span><div class="manager-identity"><strong>You → Alex Rivera</strong><small>Executed Sep 18</small></div></div>${timeline([{label:'Proposed',state:'done'},{label:'You',state:'done'},{label:'Alex',state:'done'},{label:'Executed',state:'done'}])}</div><p class="proposal-what">Jake Ferguson for Jakobi Meyers</p></li></ul>`;
}

/* ---------- C · Face-off ---------- */
function exchangeLeg(side) {
  const rows = sideRows(side), send = side === 'send';
  return `<div class="exchange-leg ${send ? 'is-out' : 'is-in'}"><p class="eyebrow">${send ? `You send → ${partnerFirst()}` : `You receive ← ${partnerFirst()}`}</p>${rows.map(p => dealRow(p)).join('') || `<p class="deal-empty">${send ? 'Pick from your roster' : state.partner ? `Pick from ${partnerFirst()}’s roster` : 'Choose a partner'}</p>`}</div>`;
}
function exchangeLedger() {
  const out = chosen('send'), inn = chosen('receive');
  if (!out.length && !inn.length) return '';
  const pts = rows => rows.reduce((t,p) => t + p.week, 0).toFixed(1);
  const yrs = rows => rows.length ? `${Math.max(...rows.map(p => p.years))}y` : '—';
  const row = (label, a, b) => `<div><dt>${label}</dt><dd><span>${a}</span><span class="ledger-sep" aria-hidden="true">·</span><span>${b}</span></dd></div>`;
  return `<dl class="exchange-ledger"><div class="ledger-key"><dt></dt><dd><span>Out</span><span class="ledger-sep" aria-hidden="true"></span><span>In</span></dd></div>${knownWeek() ? row('Week pts', out.length ? pts(out) : '—', inn.length ? pts(inn) : '—') : ''}${state.salary ? row('Salary', out.length ? money(sum(out,'salary')) : '—', inn.length ? money(sum(inn,'salary')) : '—') : ''}${state.salary ? row('Longest deal', yrs(out), yrs(inn)) : row('Players', out.length, inn.length)}</dl>`;
}
function exchangeColumn() {
  return `<section class="exchange" aria-label="The exchange"><header class="exchange-head"><h2>The exchange</h2><span class="live-label">Live</span></header>${exchangeLeg('send')}<span class="deal-swap deal-swap-large" aria-hidden="true">⇄</span>${exchangeLeg('receive')}${exchangeLedger()}<div class="exchange-result">${figures().map(f => figureMarkup(f,'figure-compact')).join('')}</div><p class="consequence-line"><strong>${headline()}</strong></p><button class="text-link" data-open-impact>Full impact ↗</button></section>`;
}
function phoneViewsC() {
  return `<nav class="phone-views" aria-label="Builder view">${[['send','Send',state.send.size],['receive','Receive',state.receive.size],['impact','Exchange','']].map(([id,label,n]) => `<button data-phone="${id}" aria-pressed="${state.phone === id}">${label}${n !== '' ? ` (${n})` : ''}</button>`).join('')}</nav>`;
}
function flowCBuilder() {
  return `<div class="desk-workspace faceoff" data-phone-view="${state.phone}">${phoneViewsC()}<div class="desk-main">${searchToolbar()}<div class="faceoff-grid" id="roster-pair">${rosterPanel('send')}<div class="exchange-col">${exchangeColumn()}</div>${rosterPanel('receive')}</div><div class="builder-foot">${advancedLink()}<span class="meta">${knownWeek() ? 'Week 6 · PPR estimates' : 'Weekly estimates unavailable'}</span></div></div></div>`;
}
function duelHalf({who, team, initials:ini, rows, banner, cls, footer, status}) {
  return `<div class="duel-half ${cls}" style="--banner:url('trade-banner-images/${banner}.svg')"><header class="duel-head"><span class="owner-avatar">${ini}</span><div class="manager-identity"><strong>${who}</strong><small>${team}</small></div>${status ? `<span class="inbox-status ${status.tone}">${status.text}</span>` : ''}</header><p class="eyebrow">Sends</p><div class="duel-rows">${rows.map(p => dealRow(p,{remove:false})).join('') || '<p class="deal-empty">Nothing</p>'}</div><footer class="duel-foot">${footer}</footer></div>`;
}
function duelCard({sendRows, receiveRows, statusYou, statusThem, center}) {
  const m = metrics(), partner = currentPartner() || managers.jordan;
  return `<section class="duel" aria-label="Trade review">${duelHalf({who:`${you.name} · You`, team:you.team, initials:you.initials, rows:sendRows, banner:'city', cls:'duel-you', status:statusYou, footer: state.salary ? `Cap room ${money(roomBefore())} → <strong class="${m.myRoom < 0 ? 'blocking' : ''}">${money(m.myRoom)}</strong> · Roster ${m.myCount}/18` : `Roster ${mine.length} → <strong>${m.myCount}</strong> / 18`})}<div class="duel-center">${center}</div>${duelHalf({who:partner.name, team:partner.team, initials:partner.initials, rows:receiveRows, banner:'stadium', cls:'duel-them', status:statusThem, footer: state.salary ? `Cap room ${money(theirRoomBefore())} → <strong class="${m.theirRoom < 0 ? 'blocking' : ''}">${money(m.theirRoom)}</strong> · Roster ${m.theirCount}/18` : `Roster ${partner.rows.length} → <strong>${m.theirCount}</strong> / 18`})}</section>`;
}
function duelCenter() {
  const m = metrics(), weekOk = knownWeek() && hasPackage();
  return `<span class="deal-swap deal-swap-large" aria-hidden="true">⇄</span><div class="duel-result"><strong class="${weekOk ? (m.delta < 0 ? 'down' : 'up') : ''}">${weekOk ? signed(m.delta) : '—'}</strong><span>your starters · Week 6</span><small>${weekOk ? `${m.beforeWeek.toFixed(1)} → ${m.afterWeek.toFixed(1)} · private` : state.offseason ? 'In-season only' : 'Forecast unavailable'}</small></div><p class="consequence-line"><strong>${headline()}</strong></p><div class="deal-verdict ${verdictClass()}" role="status">${verdictText()}</div>`;
}
function flowCReview() {
  return `<div class="review-heading"><h2>Review this trade</h2><button class="text-link" data-action="edit">← Edit package</button></div>${duelCard({sendRows:sideRows('send'), receiveRows:sideRows('receive'), center:duelCenter()})}<div class="review-grid">${noteField()}${afterPropose()}</div>${analysisDisclosures()}`;
}
function flowCInbox() {
  const pending = state.inbox === 'pending', sent = state.proposed;
  const incoming = withPackage(['cook'],['wilson'], () => {
    const m = metrics();
    const center = `<span class="deal-swap deal-swap-large" aria-hidden="true">⇄</span><div class="duel-result"><strong class="${knownWeek() ? (m.delta < 0 ? 'down' : 'up') : ''}">${knownWeek() ? signed(m.delta) : '—'}</strong><span>your starters · Week 6</span><small>private to you</small></div><p class="consequence-line"><strong>${headline()}</strong></p><span class="inbox-status ${pending ? 'is-attention' : state.inbox === 'accepted' ? 'is-positive' : 'is-muted'}">${pending ? 'Waiting for your response' : state.inbox === 'accepted' ? (state.linked ? 'Accepted · waiting for Sleeper' : 'Executed') : 'Declined'}</span>`;
    return `<article class="inbox-duel"><p class="inbox-kicker"><strong>Jordan Davis</strong> proposed · 2h ago</p>${duelCard({sendRows:sideRows('send'), receiveRows:sideRows('receive'), center, statusYou:{text: pending ? 'Your call' : state.inbox === 'accepted' ? 'Accepted' : 'Declined', tone: pending ? 'is-attention' : state.inbox === 'accepted' ? 'is-positive' : 'is-muted'}, statusThem:{text:'Accepted', tone:'is-positive'}})}<div class="inbox-actions">${pending ? '<button class="btn btn-ghost" data-action="review-inbox">Review in builder</button><button class="btn btn-ghost" data-action="accept">Accept terms</button><button class="text-link" data-action="decline">Decline</button>' : '<button class="btn btn-ghost" data-action="reset-inbox">Reset preview</button>'}</div></article>`;
  });
  const yours = sent ? `<article class="inbox-duel"><p class="inbox-kicker"><strong>You</strong> proposed to ${sent.partner} · just now</p>${duelCard({sendRows:sideRows('send'), receiveRows:sideRows('receive'), center:`<span class="deal-swap deal-swap-large" aria-hidden="true">⇄</span><span class="inbox-status is-attention">Waiting for acceptances</span>`, statusYou:{text:'Accepted', tone:'is-positive'}, statusThem:{text:'Waiting', tone:'is-attention'}})}<div class="inbox-actions"><button class="btn btn-ghost" data-action="cancel-proposal">Cancel proposal</button></div></article>` : '';
  return `<div class="inbox-stack">${yours}${incoming}</div>`;
}

/* ---------- wiring ---------- */
builder = () => flow === 'a' ? flowABuilder() : flow === 'b' ? flowBBuilder() : flowCBuilder();
review = () => flow === 'a' ? flowAReview() : flow === 'b' ? flowBReview() : flowCReview();
inbox = () => flow === 'a' ? flowAInbox() : flow === 'b' ? flowBInbox() : flowCInbox();
const baseBar = renderBar;
renderBar = () => {
  const bar = $('#package-bar');
  bar.hidden = state.tab !== 'build';
  if (flow === 'a') { bar.className = 'package-bar package-bar-deal'; bar.innerHTML = dealCardBar(); return; }
  baseBar();
  bar.querySelectorAll('[title]').forEach(el => el.removeAttribute('title'));
};
function rerenderRosters() {
  const pair = $('#roster-pair'); if (!pair) return;
  if (flow === 'b') pair.innerHTML = groupedRosterPanel('send') + groupedRosterPanel('receive');
  else if (flow === 'c') pair.innerHTML = rosterPanel('send') + `<div class="exchange-col">${exchangeColumn()}</div>` + rosterPanel('receive');
  if (typeof updateDesktopRosterCaps === 'function') updateDesktopRosterCaps();
}
document.addEventListener('input', event => {
  if (event.target.id !== 'player-search' || flow === 'a') return;
  event.stopImmediatePropagation();
  state.query = event.target.value;
  rerenderRosters();
}, true);
document.addEventListener('click', event => {
  const b = event.target.closest('button'); if (!b || b.disabled) return;
  if (b.dataset.toggleGroup) {
    const side = b.dataset.groupSide, pos = b.dataset.toggleGroup;
    if (openGroups[side].has(pos)) openGroups[side].delete(pos); else openGroups[side].add(pos);
    render(); $(`[data-toggle-group="${pos}"][data-group-side="${side}"]`)?.focus({preventScroll:true});
  }
});
const flowParams = new URLSearchParams(location.search);
if (flowParams.get('proposed') === '1') state.proposed = {partner:'Jordan Davis', names:'James Cook ↔ Garrett Wilson'};
if (flowParams.get('tab') === 'inbox') state.tab = 'inbox';
render();
