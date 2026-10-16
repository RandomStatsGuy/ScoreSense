/* Three review-only layouts sharing the hybrid's fixture and trade interactions. */
const concept = document.body.dataset.concept;
const conceptNames={a:'Trade desk',b:'Lineup lab',c:'Package board'};
const baseRender=render;
const baseReview=review;
let lineupExpanded=false;
let poolSide='receive';
let pickerOpen=false;
let pickerSide='send';
const posFilters=()=>`<details class="position-menu"><summary>${state.pos==='All'?'All positions':state.pos} <span aria-hidden="true">⌄</span></summary><div class="position-filters" aria-label="Player position">${['All','QB','RB','WR','TE'].map(pos=>`<button data-pos="${pos}" aria-pressed="${state.pos===pos}">${pos}</button>`).join('')}</div></details>`;
const searchToolbar=(id='player-search')=>`<div class="builder-toolbar">${searchMarkup(id,'Search both rosters…')}${posFilters()}</div>`;
const advancedLink=()=>`<button class="advanced-button" data-action="advanced"><span aria-hidden="true">⊕</span> Advanced terms</button>`;
const deltaValue=()=>!hasPackage()||!knownWeek()?'—':`${metrics().delta>0?'+':''}${metrics().delta.toFixed(1)}`;
function impactBand(extraClass='') {
  const m=metrics();
  return `<section class="impact-band ${extraClass}" aria-label="Package impact"><div class="band-week"><span class="band-label">Your starters · Week 6</span><strong class="${m.delta<0?'down':'up'}">${deltaValue()}<small>${knownWeek()&&hasPackage()?' pts':''}</small></strong><span class="band-note">${knownWeek()&&hasPackage()?`${m.beforeWeek.toFixed(1)} → ${m.afterWeek.toFixed(1)} · PPR P50`:state.offseason?'Available in-season':state.missing?'Forecast unavailable':'Choose players to compare'}</span></div>${state.salary?`<div><span class="band-label">Your cap room</span><strong class="${m.myRoom<0?'blocking':''}">${money(m.myRoom)}</strong><span class="band-note">${money(cap()-m.before-6)} before · ${money(cap())} cap</span></div><div class="band-partner"><span class="band-label">Partner cap room</span><strong>${currentPartner()?money(m.theirRoom):'—'}</strong><span class="band-note">${currentPartner()?.name || 'Choose a partner'}</span></div>`:`<div><span class="band-label">Your roster</span><strong>${m.myCount}<small> / 18</small></strong><span class="band-note">${mine.length} before trade</span></div><div class="band-partner"><span class="band-label">WR depth</span><strong>${count(afterRows(),'WR')}</strong><span class="band-note">${count(mine,'WR')} before trade</span></div>`}<button class="text-link" data-open-impact>Full impact ↗</button></section>`;
}
function deskBuilder() {
  return `<div class="desk-workspace" data-phone-view="${state.phone}">${impactBand()}${phoneViews()}<div class="desk-main">${searchToolbar()}<div class="roster-pair" id="roster-pair">${rosterPanel('send')}${rosterPanel('receive')}</div><div class="builder-foot">${advancedLink()}<span class="meta">${knownWeek()?'Week 6 · PPR estimates':'Weekly estimates unavailable'}</span></div></div><div class="desk-phone-impact">${impactRail()}</div></div>`;
}
function plan(rows) {
  const remaining=rows.slice().sort((a,b)=>b.week-a.week);
  return [['QB',['QB']],['RB 1',['RB']],['RB 2',['RB']],['WR 1',['WR']],['WR 2',['WR']],['TE',['TE']],['FLEX',['RB','WR','TE']],['K',['K']],['DEF',['DEF']]].map(([slot,allowed])=>{
    const at=remaining.findIndex(p=>allowed.includes(p.pos));
    return {slot,player:at<0?null:remaining.splice(at,1)[0]};
  });
}
function lineupBoard() {
  const before=plan(mine), after=plan(afterRows());
  const rows=before.map((entry,i)=>({...entry,next:after[i].player,changed:entry.player?.id!==after[i].player?.id}));
  const changed=rows.filter(r=>r.changed);
  const shown=!hasPackage()||lineupExpanded?rows:changed;
  const m=metrics();
  return `<section class="lineup-board" aria-label="Your starting lineup preview"><header class="lineup-board-head"><div><p class="eyebrow">Your starters · Week 6</p><h2>What changes on Sunday?</h2></div><button class="text-link" data-open-picker="receive">Edit players ↗</button></header><div class="lineup-score"><div><span>Current</span><strong>${knownWeek()?m.beforeWeek.toFixed(1):'—'}</strong></div><span class="score-arrow" aria-hidden="true">→</span><div><span>After trade</span><strong>${hasPackage()&&knownWeek()?m.afterWeek.toFixed(1):'—'}</strong></div><div class="score-change"><span>Week pts · PPR P50</span><strong class="${m.delta<0?'down':'up'}">${deltaValue()}</strong></div></div>${knownWeek()?`<div class="lineup-key"><span>Slot</span><span>Current starter</span><span>After trade</span><span>Δ pts</span></div><div class="lineup-rows">${shown.map(r=>`<div class="lineup-row${r.changed?' is-changed':''}"><span class="lineup-slot">${r.slot}</span><div><strong title="${r.player?.name||'Empty'}">${r.player?.name || 'Empty'}</strong><small>${r.player?weekText(r.player.week):'—'}</small></div><div><strong title="${r.next?.name||'Empty'}">${r.next?.name || 'Empty'}</strong><small>${r.next?weekText(r.next.week):'—'}</small></div><span class="lineup-delta ${r.changed&&(r.next?.week||0)<(r.player?.week||0)?'down':r.changed?'up':''}">${r.changed?`${(r.next?.week||0)>(r.player?.week||0)?'+':''}${((r.next?.week||0)-(r.player?.week||0)).toFixed(1)}`:'—'}</span></div>`).join('') || '<p class="empty-roster">No projected starter changes in this package.</p>'}</div><footer class="lineup-footer"><span class="meta">${changed.length} slots change · Your private preview</span><button class="text-link" data-expand-lineup>${lineupExpanded?'Changed slots only':'View all 9 starters'} <span aria-hidden="true">⌄</span></button></footer>`:`<div class="empty-roster">${state.offseason?'Weekly lineups return in-season.':'Weekly projections unavailable. You can still build a package.'}</div>`}<p class="lineup-method">Current and after lineups use the best projected starters in this mock.</p></section>`;
}
function packageCard(side,large=false) {
  const rows=chosen(side), send=side==='send';
  return `<section class="package-side${large?' package-side-large':''}"><div class="package-side-heading"><h3>${send?'You send':'You receive'}</h3><span class="meta">${rows.length} player${rows.length===1?'':'s'}</span></div>${rows.map(p=>`<article class="deal-player"><span class="deal-position" aria-hidden="true">${p.pos}</span><div class="deal-identity"><span class="deal-direction">${send?`To ${currentPartner()?.name||'partner'}`:`From ${currentPartner()?.name||'partner'}`}</span><strong>${p.name}</strong><small>${state.salary?`${money(p.salary)} · ${p.years}y · ${p.kind}`:`${p.pos} · PPR projection`}</small></div><button class="deal-remove" data-remove-player="${p.id}" data-remove-side="${side}" aria-label="Remove ${p.name} from package">×</button></article>`).join('') || `<div class="empty-package"><strong>${send?'Who can you move?':'Who makes you better?'}</strong><p class="meta">Add a player from ${send?'your':"your partner’s"} roster.</p></div>`}<button class="add-player" data-open-picker="${side}">+ ${rows.length?'Add another player':'Choose a player'}</button></section>`;
}
function labBuilder() {
  const m=metrics();
  return `<div class="lab-layout"><div class="lab-main">${lineupBoard()}<div class="lab-reason"><span class="reason-mark" aria-hidden="true">⇄</span><div><h3>${hasPackage()?'See every starter tradeoff.':'Try a package. See the starting lineup.'}</h3><p>${hasPackage()?'A trade can affect more than one slot. Compare individual starter changes with the net projection above.':'Choose players to see who starts, who moves, and what the total gains or gives up.'}</p></div></div></div><aside class="lab-package" aria-label="Selected trade package"><div class="rail-heading"><h2>Your package</h2><button class="text-link" data-action="partner">${currentPartner()?'Change partner':'Choose partner'}</button></div>${packageCard('send')}${packageCard('receive')}<div class="lab-cap">${state.salary?`<span>Your cap room</span><strong class="${m.myRoom<0?'blocking':''}">${money(m.myRoom)}</strong><span class="meta">${money(cap()-m.before-6)} before · dead cap included</span>`:`<span>Roster space</span><strong>${m.myCount}/18</strong>`}<button class="text-link" data-open-impact>Full impact ↗</button></div>${advancedLink()}</aside></div>`;
}
function poolRows() {
  const sources=poolSide==='both'?['send','receive']:[poolSide];
  const entries=sources.flatMap(side=>(side==='send'?mine:currentPartner()?.rows || []).map(p=>({p,side})));
  const filtered=entries.filter(({p})=>(state.pos==='All'||state.pos===p.pos)&&`${p.name} ${p.pos}`.toLowerCase().includes(state.query.toLowerCase()));
  return `<ul class="player-list pool-list">${filtered.slice(0,state.expanded[poolSide]||state.query?50:6).map(({p,side})=>playerRow(p,side).replace('<small>',`<small>${poolSide==='both'?`${side==='send'?'You':currentPartner().name.split(' ')[0]} · `:''}`)).join('') || '<li class="empty-roster">No players match your filters.</li>'}</ul>`;
}
function pool() {
  return `<section class="scouting-pool"><header class="pool-heading"><div><h2>Scout the rosters</h2><span class="meta">Add a player to try a different deal</span></div><div class="pool-teams" aria-label="Roster source">${[['send','Your roster'],['receive','Partner'],['both','Both']].map(([side,label])=>`<button data-pool-side="${side}" aria-pressed="${poolSide===side}">${label}</button>`).join('')}</div></header>${searchToolbar()}<div id="roster-pair">${poolRows()}</div><button class="text-link pool-expand" data-pool-expand>${state.expanded[poolSide]?'Show fewer players':'View full roster'} ⌄</button></section>`;
}
function canvasBuilder() {
  return `<div class="canvas-layout"><div class="canvas-main"><div class="canvas-partner"><p class="eyebrow">Your package${currentPartner()?` with ${currentPartner().name}`:''}</p><button class="text-link" data-action="partner">${currentPartner()?'Change partner':'Choose partner'} ⌄</button></div><div class="exchange-board">${packageCard('send',true)}<span class="exchange-mark" aria-hidden="true">⇄</span>${packageCard('receive',true)}</div>${impactBand('canvas-phone-band')}${pool()}<div class="builder-foot">${advancedLink()}<button class="text-link" data-open-impact>Review full impact ↗</button></div></div><aside class="canvas-rail">${impactRail()}</aside></div>`;
}
builder=()=>concept==='a'?deskBuilder():concept==='b'?labBuilder():canvasBuilder();
review=()=>baseReview();
function updateDesktopRosterCaps() {
  if(concept!=='a')return;
  const m=metrics();
  all('.desk-main .roster-header').forEach(header=>{
    header.querySelector('.desk-team-status')?.remove();
    const yours=header.closest('[data-side]').dataset.side==='send';
    const rows=yours?afterRows():afterPartnerRows(), room=yours?m.myRoom:m.theirRoom;
    header.insertAdjacentHTML('beforeend',`<div class="desk-team-status"><span>${state.salary?`${money(room)} cap room`:`${rows.length}/18 rostered`}</span><span>RB ${count(rows,'RB')} · WR ${count(rows,'WR')} · TE ${count(rows,'TE')}</span></div>`);
  });
}
function pickerContents() {
  return `<div class="picker-context"><span class="meta">Selections update the package immediately.</span><button class="text-link" data-action="close-dialog">Done choosing</button></div><div class="picker-workspace" data-phone-view="${state.phone}"><nav class="phone-views" aria-label="Choose roster">${['send','receive'].map(side=>`<button data-phone="${side}" aria-pressed="${state.phone===side}">${side==='send'?'You send':'You receive'} (${state[side].size})</button>`).join('')}</nav>${searchToolbar('picker-player-search')}<div class="roster-pair" id="picker-roster-pair">${rosterPanel('send')}${rosterPanel('receive')}</div></div>`;
}
function updatePicker() {
  if(!pickerOpen||!$('#trade-dialog').open)return;
  const focused=document.activeElement?.dataset.playerToggle;
  const focusedPosition=document.activeElement?.dataset.pos;
  const focusedPhone=document.activeElement?.dataset.phone;
  $('#dialog-body').innerHTML=`<div class="dialog-heading"><h2 id="dialog-title">Choose players</h2><button data-action="close-dialog" aria-label="Close dialog">×</button></div>${pickerContents()}`;
  if(focused)$('#trade-dialog').querySelector(`[data-player-toggle="${focused}"]`)?.focus({preventScroll:true});
  else if(focusedPosition)$('#trade-dialog').querySelector('.position-menu > summary')?.focus({preventScroll:true});
  else if(focusedPhone)$('#trade-dialog').querySelector(`[data-phone="${focusedPhone}"]`)?.focus({preventScroll:true});
}
render=()=>{
  baseRender();
  $('.trade-hero h1').textContent=conceptNames[concept]+'.';
  $('#hero-support').textContent=concept==='a'?'Both rosters open. Every move updates the deal.':concept==='b'?'See which starters change before you propose.':'Put the deal together. Explore alternatives below.';
  updateDesktopRosterCaps();
  updatePicker();
  if(pickerOpen)lastDialogTrigger=$(`[data-open-picker="${pickerSide}"]`)||$('[data-open-picker]');
};
$('#trade-dialog').addEventListener('close',()=>{pickerOpen=false;$('#trade-dialog').classList.remove('player-picker','impact-dialog');});
document.addEventListener('click',event=>{
  const b=event.target.closest('button');if(!b||b.disabled)return;
  if(b.dataset.state) {lineupExpanded=false;$('.preview-options').open=false;}
  if(b.hasAttribute('data-expand-lineup')) {lineupExpanded=!lineupExpanded;render();$('[data-expand-lineup]')?.focus({preventScroll:true});}
  if(b.hasAttribute('data-pool-side')) {poolSide=b.dataset.poolSide;render();$(`[data-pool-side=${poolSide}]`)?.focus({preventScroll:true});}
  if(b.hasAttribute('data-pool-expand')) {state.expanded[poolSide]=!state.expanded[poolSide];render();}
  if(b.dataset.removePlayer) {const side=b.dataset.removeSide;state[side].delete(b.dataset.removePlayer);render();$(`[data-open-picker="${side}"]`)?.focus({preventScroll:true});announce('Player removed; package impact updated.');}
  if(b.hasAttribute('data-open-impact')) {pickerOpen=false;$('#trade-dialog').classList.add('impact-dialog');openDialog('Package impact',impactRail());}
  if(b.hasAttribute('data-open-picker')) {
    if(state.noPartners) {openDialog('Invite managers','<p class="muted">Invite another manager from Roster management · Members.</p>');return;}
    if(!state.partner) {partnerDialog();return;}
    pickerSide=b.dataset.openPicker;state.phone=pickerSide;state.query='';state.pos='All';pickerOpen=true;
    $('#trade-dialog').classList.add('player-picker');openDialog('Choose players',pickerContents());
  }
});
document.addEventListener('input',event=>{
  if(event.target.id!=='player-search')return;
  if(concept==='c'&&!pickerOpen)$('#roster-pair').innerHTML=poolRows();
  updateDesktopRosterCaps();
});
document.addEventListener('input',event=>{
  if(event.target.id!=='picker-player-search'||!pickerOpen)return;
  event.stopImmediatePropagation();state.query=event.target.value;
  $('#trade-dialog').querySelector('#picker-roster-pair').innerHTML=rosterPanel('send')+rosterPanel('receive');
},true);
document.addEventListener('keydown',event=>{
  if(event.key!=='Escape')return;
  const menus=all('.position-menu[open]');
  if(menus.length)event.preventDefault();
  menus.forEach(d=>{d.open=false;d.querySelector('summary')?.focus();});
  all('.preview-options[open]').forEach(d=>d.open=false);
});
render();
