/* Illustrative outlooks only. The preview never calls a league write endpoint. */
(() => {
  const players = [
    {id:'9500',name:'Josh Downs',pos:'WR',team:'IND',pts:181,low:128,high:238,pg:10.6,bid:8},
    {id:'8676',name:'Rashid Shaheed',pos:'WR',team:'SEA',pts:174,low:101,high:252,pg:10.2,bid:7},
    {id:'9508',name:'Tyjae Spears',pos:'RB',team:'TEN',pts:166,low:110,high:227,pg:9.8,bid:6},
    {id:'9484',name:'Tucker Kraft',pos:'TE',team:'GB',pts:158,low:115,high:211,pg:9.3,bid:5},
    {id:'10232',name:'Michael Wilson',pos:'WR',team:'ARI',pts:147,low:92,high:209,pg:8.6,bid:4},
    {id:'8131',name:'Isaiah Likely',pos:'TE',team:'NYG',pts:139,low:82,high:212,pg:8.2,bid:4},
    {id:'4943',name:'Sam Darnold',pos:'QB',team:'SEA',pts:264,low:213,high:314,pg:15.5,bid:3},
    {id:'8134',name:'Khalil Shakir',pos:'WR',team:'BUF',pts:169,low:121,high:217,pg:9.9,bid:6},
  ];
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const b = document.body.dataset.option === 'b';
  let scenario = new URLSearchParams(location.search).get('state') || 'bid';
  if (!['bid','claim','add','pre'].includes(scenario)) scenario = 'bid';
  let position='ALL', sort=scenario==='bid'?'bid':'pts', query='', risk='all', watchedOnly=false;
  const watched=new Set(), saved=new Set();
  const dialog=$('#fa-dialog');
  let selected=null, returnFocus=null;
  const caret='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m7 10 5 5 5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  const icon=(kind)=>`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">${kind==='close'?'<path d="m6 6 12 12M18 6 6 18"/>':kind==='filter'?'<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="var(--bg-base)"/><circle cx="15" cy="17" r="3" fill="var(--bg-base)"/>':'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v1"/>'}</svg>`;
  const action=()=>scenario==='claim'?'Claim':scenario==='bid'?'Bid':'Add';
  const face=p=>`<span class="fa-face"><span aria-hidden="true">${p.name.split(' ').map(n=>n[0]).slice(0,2).join('')}</span><img src="https://sleepercdn.com/content/nfl/players/thumb/${p.id}.jpg" width="96" height="96" alt="" loading="lazy"></span>`;
  const band=p=>`<div class="fa-range-track" style="--low:${p.low/3.5}%;--high:${p.high/3.5}%;--median:${p.pts/3.5}%" aria-hidden="true"></div>`;
  const sorted=()=>players.filter(p=>(position==='ALL'||p.pos===position)&&(!query||`${p.name} ${p.team}`.toLowerCase().includes(query.toLowerCase()))&&(!watchedOnly||watched.has(p.id))&&(risk==='all'||(risk==='floor'?p.low/p.pts>.67:p.high/p.pts>1.4))).sort((a,c)=>c[sort]-a[sort]);
  function toast(text){const t=$('#preview-toast');t.textContent=text;t.hidden=false;clearTimeout(window.faToastTimer);window.faToastTimer=setTimeout(()=>t.hidden=true,3500);}
  function onImages(){ $$('img').forEach(img=>img.addEventListener('error',()=>img.hidden=true,{once:true})); }
  function menu(id,label,items,value){return `<details class="fa-menu" id="${id}"><summary><span><small>${label}</small><strong>${items.find(x=>x[0]===value)[1]}</strong>${caret}</span></summary><div class="fa-menu-options" role="radiogroup" aria-label="${label}">${items.map(([key,text])=>`<button type="button" role="radio" aria-checked="${key===value}" data-${id}="${key}">${text}</button>`).join('')}</div></details>`;}
  function render(){
    document.body.dataset.state=scenario;
    $$('[data-scenario]').forEach(el=>el.setAttribute('aria-checked',el.dataset.scenario===scenario));
    const windowCopy={bid:['Bids close Wednesday','12:00 PM ET · $42 available cap'],claim:['Waivers run Wednesday','12:00 PM ET · Your priority: 4'],add:['Free agency is open','Players can be added now'],pre:['Adds open after the draft','Star players for draft night']}[scenario];
    $('#fa-window').innerHTML=`<div class="fa-window-copy" id="fa-window-reason"><strong>${windowCopy[0]}</strong><span>${windowCopy[1]}</span></div><button class="fa-icon" type="button" id="fa-how" aria-label="How adds work">${icon('info')}</button>`;
    $('#fa-toolbar').innerHTML=menu('position','Pos',[['ALL','All'],['QB','QB'],['RB','RB'],['WR','WR'],['TE','TE']],position)+menu('sort','Sort',[['pts','Season pts'],['high','Ceiling'],['low','Floor'],...(scenario==='bid'?[['bid','Bid value']]:[])],sort)+`<button class="fa-icon" id="fa-filters" type="button" aria-label="Search and filters">${icon('filter')}</button>`;
    const list=sorted();
    $('#fa-count').textContent=`${list.length} players${query?' · '+query:''}${watchedOnly?' · Starred':''}`;
    $('#fa-scoring').textContent=scenario==='bid'?'Season outlook · PPR · Balanced bids':'Season outlook · PPR';
    $('#fa-pool').innerHTML=list.length?list.map(p=>`<article class="fa-player" data-player="${p.id}"><div class="fa-player-top"><button type="button" class="fa-profile" data-profile="${p.id}" aria-label="View ${p.name}">${face(p)}<span class="fa-name"><strong>${p.name}</strong><span>${p.pos} · ${p.team}</span>${!b?`<span>${p.pg.toFixed(1)} projected / game</span>`:''}</span></button><div class="fa-outlook">${b?`<div><strong>${p.pg.toFixed(1)}</strong><small>projected / game</small></div>${scenario==='bid'?`<span class="fa-suggested">Suggested $${p.bid}</span>`:''}`:`<strong>${p.pts}</strong><small>season pts</small>`}</div></div><div class="fa-player-bottom"><div class="fa-range">${b?`<div class="fa-range-copy"><strong>${p.pts} season pts</strong><span>${p.low}–${p.high}</span></div>`:`<div class="fa-range-copy"><span>${p.low}–${p.high} range</span>${scenario==='bid'?`<span>Suggested $${p.bid}</span>`:''}</div>`}${band(p)}</div>${scenario==='pre'?`<button type="button" class="fa-acquire fa-draft-star" data-star="${p.id}" aria-pressed="${watched.has(p.id)}" aria-label="Star ${p.name} for draft">${watched.has(p.id)?'★ Starred':'☆ Star'}</button><button type="button" class="fa-acquire" disabled aria-describedby="fa-window-reason">Add</button>`:`<button type="button" class="fa-acquire${saved.has(p.id)?' is-saved':''}" data-action="${p.id}" ${saved.has(p.id)?'disabled':''}>${saved.has(p.id)?(scenario==='bid'?'Bid in':scenario==='claim'?'Claimed':'Added'):action()}</button>`}</div></article>`).join(''):`<div class="fa-empty"><p>No players match these filters.</p><button type="button" class="btn btn-ghost" id="fa-reset">Reset filters</button></div>`;

    $('#fa-how').onclick=openHow;
    $('#fa-filters').onclick=openFilters;
    $$('[data-position]').forEach(el=>el.onclick=()=>{position=el.dataset.position;render();$('#position summary').focus();});
    $$('[data-sort]').forEach(el=>el.onclick=()=>{sort=el.dataset.sort;render();$('#sort summary').focus();});
    $$('[data-profile]').forEach(el=>el.onclick=()=>openPlayer(el.dataset.profile,el));
    $$('[data-action]').forEach(el=>el.onclick=()=>openPlayer(el.dataset.action,el));
    $$('[data-star]').forEach(el=>el.onclick=()=>{watched.has(el.dataset.star)?watched.delete(el.dataset.star):watched.add(el.dataset.star);const id=el.dataset.star;render();$(`[data-star="${id}"]`).focus();});
    if($('#fa-reset'))$('#fa-reset').onclick=()=>{position='ALL';query='';risk='all';watchedOnly=false;render();};
    onImages();
  }
  function show(title,content,footer=''){
    returnFocus=document.activeElement;
    dialog.innerHTML=`<header class="fa-dialog-head"><h2 id="fa-dialog-title">${title}</h2><button class="fa-icon" type="button" id="fa-close" aria-label="Close">${icon('close')}</button></header><div class="fa-dialog-content">${content}</div>${footer?`<footer class="fa-dialog-footer">${footer}</footer>`:''}`;
    $('#fa-close').onclick=()=>dialog.close();dialog.showModal();onImages();
  }
  function openPlayer(id,trigger){
    selected=players.find(p=>p.id===id);
    const p=selected;
    const acquisition=scenario==='bid'?`<div><p class="meta">Suggested $${p.bid} · PPR · Balanced</p></div><div class="fa-bid-fields"><label class="fa-field">Your bid ($)<input id="fa-amount" type="number" min="1" max="42" value="${p.bid}"></label><label class="fa-field">Walk-away ($)<input id="fa-ceiling" type="number" min="1" value="${p.bid}"></label></div><p id="fa-after" class="meta">If won · $${42-p.bid} cap left</p><p id="fa-bid-error" class="fa-warning" role="status" hidden></p>`:scenario==='claim'?`<p class="meta">Priority 4 · Runs Wednesday, 12:00 PM ET</p><div class="fa-field">Drop if successful<div class="fa-choice-group" role="radiogroup" aria-label="Drop if successful"><button role="radio" aria-checked="true" data-drop="none">Nobody · 1 open spot</button><button role="radio" aria-checked="false" data-drop="bench">Your bench player</button></div></div>`:scenario==='pre'?'<p class="fa-warning">Adds open after the draft.</p>':'<p class="meta">1 roster spot open</p>';
    const footer=scenario==='pre'?`<button class="btn btn-ghost" id="fa-watch">${watched.has(p.id)?'★ Starred for draft':'☆ Star for draft'}</button><button class="btn btn-primary" disabled>Add player</button>`:`<button type="button" class="btn btn-primary" id="fa-submit">${scenario==='bid'?'Place bid':scenario==='claim'?'Confirm claim':'Add player'}</button>`;
    show(action()==='Bid'?'Player & bid':'Player outlook',`<div class="fa-dialog-identity">${face(p)}<div><h3>${p.name}</h3><p class="meta">${p.pos} · ${p.team}</p></div></div><div class="fa-detail-chart"><dl class="fa-detail-stats"><div><dt>Floor</dt><dd>${p.low}</dd></div><div><dt>Season pts</dt><dd>${p.pts}</dd></div><div><dt>Ceiling</dt><dd>${p.high}</dd></div></dl>${band(p)}<p class="meta">${p.pg.toFixed(1)} projected points / game · PPR</p></div>${acquisition}<button class="fa-quiet-link" id="fa-history">${scenario==='claim'||scenario==='add'?'Player notes':'Contract history'} <span aria-hidden="true">↗</span></button>`,footer);
    returnFocus=trigger;
    $('#fa-history').onclick=()=>toast('Preview: player details. Sample data; no league changes.');
    if($('#fa-watch'))$('#fa-watch').onclick=()=>{watched.has(p.id)?watched.delete(p.id):watched.add(p.id);$('#fa-watch').textContent=watched.has(p.id)?'★ Starred for draft':'☆ Star for draft';render();};
    $$('[data-drop]').forEach(el=>el.onclick=()=>$$('[data-drop]').forEach(x=>x.setAttribute('aria-checked',x===el)));
    if($('#fa-submit'))$('#fa-submit').onclick=()=>{saved.add(p.id);dialog.close();render();toast(`Preview: ${scenario==='bid'?'bid placed':scenario==='claim'?'claim queued':'player added'} for ${p.name}. No league changes.`);};
    if(scenario==='bid'){
      const validate=()=>{const amount=Number($('#fa-amount').value),ceiling=Number($('#fa-ceiling').value);const message=amount<1||ceiling<1?'Enter an amount of at least $1.':amount>42?'This bid is above your available cap.':amount>ceiling?'Above your walk-away. Lower the bid or raise your ceiling.':'';$('#fa-bid-error').textContent=message;$('#fa-bid-error').hidden=!message;$('#fa-submit').disabled=!!message;$('#fa-after').textContent=`If won · $${42-amount} cap left`;};
      $('#fa-amount').oninput=validate;$('#fa-ceiling').oninput=validate;
    }
  }
  function openHow(){
    show('How adds work',`<p class="muted">${scenario==='bid'?'The highest bid wins when this window processes. Your walk-away is a personal limit, saved only on this device.':scenario==='claim'?'Claims run in your chosen order. A successful claim moves your team to the end of priority. A conditional drop happens only if the claim succeeds.':scenario==='pre'?'Adds open after the draft. Stars keep players on your draft watchlist.':'Adds take effect immediately during free agency.'}</p><p class="meta">All player outlooks and league dates in this mock are illustrative.</p>`);
  }
  function openFilters(){
    let pendingRisk=risk,pendingWatched=watchedOnly;
    show('Search & filters',`<label class="fa-field">Search players<input id="fa-query" type="search" placeholder="Name or team" value="${query.replace(/&/g,'&amp;').replace(/"/g,'&quot;')}"></label><div class="fa-field">Outlook<div class="fa-choice-group" role="radiogroup" aria-label="Outlook">${[['all','All'],['floor','Higher floor'],['ceiling','More upside']].map(([key,title])=>`<button type="button" role="radio" aria-checked="${risk===key}" data-risk="${key}">${title}</button>`).join('')}</div></div>${scenario==='pre'?`<button class="fa-acquire" id="fa-watch-only" aria-pressed="${watchedOnly}">Starred for draft only</button>`:''}`,'<button class="btn btn-ghost" id="fa-clear">Reset</button><button class="btn btn-primary" id="fa-apply">Show players</button>');
    $$('[data-risk]').forEach(el=>el.onclick=()=>{pendingRisk=el.dataset.risk;$$('[data-risk]').forEach(x=>x.setAttribute('aria-checked',x===el));});
    if($('#fa-watch-only'))$('#fa-watch-only').onclick=()=>{pendingWatched=!pendingWatched;$('#fa-watch-only').setAttribute('aria-pressed',pendingWatched);};
    $('#fa-clear').onclick=()=>{pendingRisk='all';pendingWatched=false;$('#fa-query').value='';$$('[data-risk]').forEach(x=>x.setAttribute('aria-checked',x.dataset.risk==='all'));if($('#fa-watch-only'))$('#fa-watch-only').setAttribute('aria-pressed','false');};
    $('#fa-apply').onclick=()=>{query=$('#fa-query').value;risk=pendingRisk;watchedOnly=pendingWatched;dialog.close();render();$('#fa-filters').focus();};
    $('#fa-query').focus();
  }
  dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});
  dialog.addEventListener('close',()=>{if(returnFocus?.isConnected)returnFocus.focus();else if(selected)$(`[data-profile="${selected.id}"]`)?.focus();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!dialog.open)$$('.fa-menu[open]').forEach(el=>{el.open=false;el.querySelector('summary').focus();});});
  document.addEventListener('click',e=>$$('.fa-menu[open]').forEach(el=>{if(!el.contains(e.target))el.open=false;}));
  $$('[data-scenario]').forEach(el=>el.onclick=()=>{scenario=el.dataset.scenario;sort=scenario==='bid'?'bid':'pts';saved.clear();render();});
  if(new URLSearchParams(location.search).has('long')){
    players[0].name='Marquez Valdes-Scantling';
    $$('.phone-league span:first-child').forEach(el=>el.textContent='The Very Long Championship League');
    $$('.phone-league').forEach(el=>el.setAttribute('aria-label','The Very Long Championship League · switch league'));
  }
  render();
})();
