/* Sample-only Home designs. No API calls and no persisted league changes. */
const option = 'b';
const params = new URLSearchParams(location.search);
const treatment = document.body.dataset.treatment;
const longNames = params.has('long');
document.body.dataset.art = params.get('art') || 'sample';
const sample = {
  upcoming:{label:'Before kickoff',title:'Your matchup',status:'Week 6 · Projected',a:'122.6',b:'115.8',unit:'Projected Week pts',note:'PPR projections',sub:'Scores appear after kickoff.',live:false},
  live:{label:'Live scoring',title:'Your matchup',status:'Week 6 · Live',a:'25.4',b:'3.0',unit:'Week pts',note:'Caleb leads by 22.4',sub:'Provisional scores · Sleeper',live:true},
  final:{label:'Final result',title:'Your matchup',status:'Week 6 · Final',a:'128.4',b:'112.7',unit:'Week pts',note:'Caleb wins by 15.7',sub:'Final scores · Sleeper',live:false},
  missing:{label:'Missing projection',title:'Your matchup',status:'Week 6 · Projected',a:'—',b:'115.8',unit:'Projected Week pts',note:'Projection unavailable',sub:'Missing forecasts stay unknown.',live:false},
  pre:{label:'Pre-draft',live:false}
};
let state = params.get('state') || 'live';
if (!sample[state]) state = 'live';
const sentMessages = [];
const reacted = new Set();
const escapeHTML = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon = type => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">${type==='chat'?'<path d="M5 5h14v10H9l-4 4V5Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M9 9h6M9 12h4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>':type==='standings'?'<path d="M4 19V11h4v8M10 19V5h4v14M16 19v-5h4v5" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>':'<circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.6"/><path d="M12 7v6M12 16v1" stroke="currentColor" stroke-width="1.6"/>'}</svg>`;
const link = (label,destination,cls='link-arrow') => `<a class="${cls}" href="#" data-preview="${destination}">${label} <span aria-hidden="true">↗</span></a>`;
const disclosure = (type,title,sub) => `<summary><span class="disclosure-heading"><span class="section-icon">${icon(type)}</span><span class="disclosure-title"><strong>${title}</strong><small>${sub}</small></span><span class="disclosure-toggle" aria-hidden="true"></span></span></summary>`;

function polishSide(you,s) {
  const owner = you ? (longNames ? 'Caleb Kensington' : 'Caleb K') : (longNames ? 'Jordan Davis-Washington' : 'Jordan D');
  const nickname = you ? (longNames ? 'The Sunday Service Fantasy Football Collective' : 'Sunday Service') : (longNames ? 'Ragdollin With Mahomies All Season Long' : 'Ragdollin With Mahomies');
  const identity = `<div class="polish-person"><span class="polish-mark" aria-hidden="true">${you?'CK':'JD'}</span><div class="polish-person-name"><strong>${owner}${you?'<small> · You</small>':''}</strong><span>${nickname}</span></div><span class="polish-record" aria-label="Season record ${you?'4 wins, 1 loss':'0 wins, 5 losses'}">${you?'4–1':'0–5'}</span></div>`;
  const value = `<div class="polish-value"><strong>${you?s.a:s.b}</strong><span>${s.unit}</span></div>`;
  return `<div class="polish-side ${you?'is-you':''}">${treatment==='b' ? value+identity : identity+value}</div>`;
}
function matchup(s) {
  const status=state==='live'?'Live':state==='final'?'Final':'Projected';
  const note = state==='live' ? 'Caleb K leads by <strong>22.4</strong>' : state==='final' ? 'Caleb K wins by <strong>15.7</strong>' : s.note;
  return `<section class="polish-matchup treatment-${treatment}" aria-labelledby="matchup-title"><div class="polish-art" aria-hidden="true"><img src="trade-banner-images/stadium.svg" alt=""><img src="trade-banner-images/city.svg" alt=""></div><header class="polish-head"><div><p class="eyebrow">2026 · Week 6</p><h1 id="matchup-title">Your matchup</h1></div><span class="polish-status ${s.live?'is-live':''}"><i aria-hidden="true"></i>${status}</span></header><div class="polish-duel">${polishSide(true,s)}<span class="polish-versus" aria-hidden="true">vs</span>${polishSide(false,s)}</div><footer class="polish-foot"><p><span>${note}</span><small>${s.sub}</small></p><div class="polish-links">${link('This Week','This Week','polish-week-link')}${link('Game center','Game center','polish-game-link')}</div></footer></section>`;
}
const chatMessages = [
  {initials:'JD',name:'Jordan D',time:'12m ago',text:'0–5 means I’m due. Sorry Caleb.',reaction:'😂',count:3},
  {initials:'CK',name:'Caleb K',time:'8m ago',text:'Let’s revisit this on Monday.',reaction:'👀',count:2},
  {initials:'SM',name:'Sam M',time:'3m ago',text:'Anyone moving a receiver? I have RB depth.',reaction:null}
];
function message(m,index) {
  return `<article class="chat-entry"><span class="chat-avatar" aria-hidden="true">${m.initials}</span><div><div class="chat-person"><strong>${m.name}</strong><time>${m.time}</time></div><p>${escapeHTML(m.text)}</p>${m.reaction?`<button class="reaction" data-reaction="${index}" aria-label="React ${m.reaction} to ${m.name}'s message" aria-pressed="${reacted.has(index)}">${m.reaction} <span>${m.count+(reacted.has(index)?1:0)}</span></button>`:''}</div></article>`;
}
function chat() {
  const messages = state==='pre' ? [
    {initials:'SM',name:'Sam M',time:'18m ago',text:'Sunday night works for me. Marked it on the calendar.',reaction:'👍',count:4},
    {initials:'JD',name:'Jordan D',time:'5m ago',text:'Same here. Ready to run it back.',reaction:null}
  ]:chatMessages;
  return `<details class="card home-chat" open>${disclosure('chat','League chat','Latest from your league')}<div class="chat-thread">${[...(option==='c'?messages.slice(0,2):messages),...sentMessages].map(message).join('')}</div><form class="chat-compose"><input aria-label="Message your league" autocomplete="off" maxlength="280" placeholder="Message your league…" required><button class="btn btn-ghost" type="submit">Send</button></form><div class="chat-foot"><span>Sample conversation</span>${link('All messages','League chat · full conversation')}</div></details>`;
}
const managers = [
  ['CK','Caleb K','4–1','653.2'],['AR','Alex R','4–1','632.8'],['SM','Sam M','3–2','610.4'],['MT','Morgan T','3–2','598.1'],['JP','Jamie P','2–3','575.6'],['JD','Jordan D','0–5','481.9']
];
function standings() {
  return `<details class="card home-standings" open>${disclosure('standings','Standings','1st of 12 · 4–1')}<table class="standings-table"><thead><tr><th scope="col">#</th><th scope="col">Manager</th><th scope="col" class="num">W–L</th><th scope="col">Pts for</th></tr></thead><tbody>${managers.slice(0,5).map((m,i)=>`<tr class="${i===0?'is-you':''}"><td>${i+1}</td><td><span class="manager"><span class="tiny-mark" aria-hidden="true">${m[0]}</span><strong>${m[1]}</strong>${i===0?'<span class="you-label">You</span>':''}</span></td><td class="num">${m[2]}</td><td>${m[3]}</td></tr>`).join('')}</tbody></table><div class="standings-footer"><span class="meta">Through Week 5</span>${link('All 12 managers','Game center · League standings')}</div></details>`;
}
function games(s) {
  const rows = [['Alex R','4–1','Sam M','3–2','118.2','120.6','18.7','22.4'],['Morgan T','3–2','Jamie P','2–3','109.3','114.8','0.0','8.6'],['Chris G','2–3','Taylor S','3–2','126.7','112.9','12.5','14.0'],['Drew W','2–3','Riley B','1–4','110.6','108.3','4.2','0.0'],['Casey L','2–3','Lee H','3–2','121.4','117.1','17.1','10.8']];
  return `<section class="card league-games"><header class="card-head"><h2>Around the league</h2><span class="meta">Week 6</span></header><p class="games-label">${s.live?'Provisional Week pts':state==='final'?'Final Week pts':'Projected Week pts · PPR'}</p>${rows.map((r,i)=>`<a class="game-row" href="#" data-preview="Game center · ${r[0]} vs ${r[2]}"><span class="game-person"><strong>${r[0]}</strong><small>${r[1]}</small></span><strong class="game-number">${s.live?r[6]:r[4]}</strong><span class="game-person"><strong>${r[2]}</strong><small>${r[3]}</small></span><strong class="game-number">${s.live?r[7]:r[5]}</strong></a>`).join('')}</section>`;
}
function preDraft() {
  return `<section class="card pre-draft"><div><span class="eyebrow">2026 · Pre-draft</span><h1>Choose your draft night.</h1><p>10 of 12 managers have marked their availability.</p></div><div><a class="btn btn-primary" href="#" data-preview="Draft · availability calendar">Choose a night <span aria-hidden="true">→</span></a></div><dl class="pre-context"><div><dt>Leftover for draft</dt><dd>$42</dd></div><div><dt>Seats filled</dt><dd>12 / 12</dd></div><div><dt>Draft night</dt><dd class="caution">Not set</dd></div></dl></section>`;
}
function attention() {
  return `<details class="card needs-attention">${disclosure('attention','Needs attention','2 contracts to review')}<div class="task-row"><span>2 to extend</span>${link('Review contracts','My team · contracts')}</div></details>`;
}
function render() {
  const s = sample[state];
  const main = document.getElementById('main-content');
  main.className = `home-grid layout-${option}`;
  if(state==='pre') {
    main.innerHTML = `<div class="home-main">${preDraft()}<section class="card draft-night"><div><h2>Draft room</h2><span class="meta">12 managers · Auction draft</span></div>${link('Open draft room','Draft')}</section></div><aside class="home-rail" aria-label="League activity">${chat()}</aside>${attention()}`;
  } else if(option==='a') {
    main.innerHTML = `<div class="home-main">${matchup(s)}${standings()}</div><aside class="home-rail" aria-label="League conversation">${chat()}</aside>`;
  } else if(option==='b') {
    main.innerHTML = `${matchup(s)}${chat()}${standings()}`;
  } else {
    main.innerHTML = `<div class="home-main">${matchup(s)}${games(s)}</div><aside class="home-rail" aria-label="League activity">${standings()}${chat()}</aside>`;
  }
  // Phone order: matchup, conversation, standings, then secondary league games.
  if(option==='a' && matchMedia('(max-width:768px)').matches && state!=='pre') {
    main.innerHTML = `${matchup(s)}${chat()}${standings()}`;
  }
  if(option==='c' && state!=='pre' && matchMedia('(max-width:768px)').matches) {
    main.innerHTML = `${matchup(s)}${chat()}${standings()}${games(s)}`;
  }
  document.querySelectorAll('[data-phase]').forEach(el=>{
    if(el.dataset.phase===(state==='pre'?'pre':'season'))el.setAttribute('aria-current','step'); else el.removeAttribute('aria-current');
  });
  document.querySelector('[data-state-label]').textContent=s.label+' ⌄';
  document.querySelector('[data-strip-phase]').textContent=state==='pre'?'Pre-draft':'In season';
  document.querySelectorAll('[data-state]').forEach(el=>el.setAttribute('aria-checked',el.dataset.state===state?'true':'false'));
}
document.addEventListener('click',event=>{
  const stateButton=event.target.closest('[data-state]');
  if(stateButton) {
    state=stateButton.dataset.state;
    render();
    stateButton.closest('details').open=false;
    document.querySelector('.review-state summary').focus();
  }
  const reaction=event.target.closest('[data-reaction]');
  if(reaction) {
    const index=Number(reaction.dataset.reaction);
    if(reacted.has(index))reacted.delete(index); else reacted.add(index);
    reaction.setAttribute('aria-pressed',String(reacted.has(index)));
    reaction.querySelector('span').textContent=chatMessages[index]?.count+(reacted.has(index)?1:0);
  }
});
document.addEventListener('submit',event=>{
  if(!event.target.matches('.chat-compose'))return;
  event.preventDefault();
  const input=event.target.querySelector('input');
  const value=input.value.trim();
  if(!value)return;
  const m={initials:'CK',name:'Caleb K · You',time:'Just now',text:value};
  sentMessages.push(m);
  event.target.closest('.home-chat').querySelector('.chat-thread').insertAdjacentHTML('beforeend',message(m,chatMessages.length+sentMessages.length));
  input.value='';
  const toast=document.getElementById('preview-toast');
  toast.textContent='Added to this sample conversation. Nothing was sent to your league.';
  toast.hidden=false;
  clearTimeout(window.homeToastTimer);
  window.homeToastTimer=setTimeout(()=>toast.hidden=true,3500);
});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape')document.querySelectorAll('.review-state[open],.nav-league[open]').forEach(el=>{el.open=false;el.querySelector('summary').focus();});
  const target=event.target.closest('[role=radio]');
  if(target && ['ArrowDown','ArrowRight','ArrowUp','ArrowLeft'].includes(event.key)) {
    event.preventDefault();
    const choices=[...target.closest('[role=radiogroup]').querySelectorAll('[role=radio]')];
    const offset=['ArrowDown','ArrowRight'].includes(event.key)?1:-1;
    choices[(choices.indexOf(target)+offset+choices.length)%choices.length].focus();
  }
});
matchMedia('(max-width:768px)').addEventListener('change',render);
render();

function setPalette(palette) {
  const classic=palette==='classic';
  document.documentElement.dataset.previewPalette=classic?'classic':'snow';
  document.documentElement.style.colorScheme=palette==='light'?'light':'dark';
  document.querySelector('[data-palette-label]').textContent=({snow:'Snow',classic:'Classic dark',light:'Soft light'}[palette]||'Snow')+' ⌄';
  document.querySelectorAll('[data-palette]').forEach(button=>button.setAttribute('aria-checked',String(button.dataset.palette===palette)));
}
document.addEventListener('click',event=>{
  const button=event.target.closest('[data-palette]');
  if(button){setPalette(button.dataset.palette);button.closest('details').open=false;document.querySelector('[data-palette-label]').focus();}
  const summary=event.target.closest('.review-state > summary');
  if(summary)document.querySelectorAll('.review-state[open]').forEach(details=>{if(details!==summary.parentElement)details.open=false;});
});
setPalette(params.get('palette')||'snow');
if(longNames) {
  const label='Tessa’s Extraordinarily Long Touchdown Memorial Fantasy League';
  document.querySelector('.phone-league > span').textContent=label;
  document.querySelector('.phone-league').setAttribute('aria-label',label+' · switch league');
  document.querySelector('.phone-league').title=label;
}
