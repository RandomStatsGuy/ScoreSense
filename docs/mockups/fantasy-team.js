/* Static, in-memory design preview. No requests or league writes. */
const roster = [
 {id:'allen',name:'Josh Allen',pos:'QB',team:'BUF',salary:33,years:2,kind:'Vet deal'},
 {id:'daniels',name:'Jayden Daniels',pos:'QB',team:'WAS',salary:3,years:3,kind:'Rookie deal'},
 {id:'bijan',name:'Bijan Robinson',pos:'RB',team:'ATL',salary:28,years:2,kind:'Rookie deal'},
 {id:'cook',name:'James Cook',pos:'RB',team:'BUF',salary:16,years:2,kind:'Vet deal',pre:'eligible'},
 {id:'charbonnet',name:'Zach Charbonnet',pos:'RB',team:'SEA',salary:5,years:2,kind:'Rookie deal'},
 {id:'lamb',name:'CeeDee Lamb',pos:'WR',team:'DAL',salary:35,years:3,kind:'Extension'},
 {id:'smith',name:'DeVonta Smith',pos:'WR',team:'PHI',salary:18,years:2,kind:'Vet deal',pre:'expiring'},
 {id:'mcbride',name:'Trey McBride',pos:'TE',team:'ARI',salary:14,years:2,kind:'Rookie deal'},
];
const positionNames = {QB:'Quarterbacks',RB:'Running backs',WR:'Wide receivers',TE:'Tight ends'};
let scenario='salary',filter='ALL',search='',searchOpen=false,selected=null,extensionYears=2;
const variant=document.body.dataset.option;
const page=document.getElementById('main-content');
const sheet=document.getElementById('contract-sheet');
const money=()=>scenario!=='standard';
const years=p=>scenario==='pre'&&p.pre?1:p.years;
const available=()=>scenario==='pre'?76:42;
const capLabel=()=>scenario==='pre'?'Leftover for draft':'Available Cap';
const status=p=>scenario==='pre'&&p.pre ? `<span class="player-state ${p.pre==='expiring'?'is-expiring':''}">${p.pre==='eligible'?'Extension eligible':'Expiring'}</span>`:'';
const searchIcon='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" stroke-width="1.8"/><path d="m16 16 4 4" stroke="currentColor" stroke-width="1.8"/></svg>';
function controls(){
 const searchField=`<label class="team-search">${searchIcon}<input id="roster-search" type="search" placeholder="Search players" aria-label="Search roster"></label>`;
 const positions=`<div class="position-filters" role="group" aria-label="Position">${['ALL','QB','RB','WR','TE'].map(pos=>`<button data-filter="${pos}" aria-pressed="${filter===pos}">${pos==='ALL'?'All':pos}<span>${pos==='ALL'?8:roster.filter(p=>p.pos===pos).length}</span></button>`).join('')}</div>`;
 return variant==='a'?`<div class="roster-control-line">${positions}<button class="search-toggle" data-search aria-label="${searchOpen?'Close search':'Search roster'}" aria-expanded="${searchOpen}">${searchIcon}</button></div>${searchOpen?searchField:''}`:searchField;
}
const row=p=>`<button class="roster-row" data-player="${p.id}" aria-label="${money()?'Contract':'Player details'} · ${p.name}"><span class="player-identity"><span class="player-name">${p.name}</span><span class="player-meta">${p.pos} · ${p.team}${money()?` · ${p.kind}`:''}</span>${money()?status(p):''}</span>${money()?`<span class="row-contract"><strong>$${p.salary}</strong><small>${years(p)} ${years(p)===1?'yr':'yrs'}</small></span>`:'<span class="row-contract"><small>Rostered</small></span>'}<span class="row-arrow" aria-hidden="true">↗</span></button>`;
function list(){
 const rows=roster.filter(p=>(filter==='ALL'||filter===p.pos)&&p.name.toLowerCase().includes(search.toLowerCase()));
 if(!rows.length)return '<p class="roster-no-results" role="status">No players match.</p>';
 if(variant==='a')return `<div class="roster-list">${rows.map(row).join('')}</div>`;
 return `<div class="team-groups">${Object.entries(positionNames).map(([pos,name])=>{
  const players=rows.filter(p=>p.pos===pos);if(!players.length)return '';
  return `<details class="card position-group" data-pos="${pos}" ${pos==='QB'||search?'open':''}><summary><span class="disclosure-heading"><span class="section-icon" aria-hidden="true">${pos}</span><span class="disclosure-title"><strong>${name}</strong><small>${players.length} ${players.length===1?'player':'players'}</small></span><span class="disclosure-toggle" aria-hidden="true"></span></span></summary><div class="roster-list">${players.map(row).join('')}</div></details>`;
 }).join('')}</div>`;
}
function render(){
 const empty=scenario==='empty';
 const identity=`<div><h1>Maya Chen · You</h1><p>Sunday Roster · ${empty?0:8} players</p></div>`;
 const overview=money()&&!empty?`<section class="team-overview" aria-label="Your team and cap">${identity}<button class="budget-link" data-preview="Cap" aria-label="Open Cap · $${available()} ${capLabel()}"><span class="budget-label">${capLabel()}</span><strong class="budget-amount">$${available()} <span class="row-arrow" aria-hidden="true">↗</span></strong></button><span class="budget-facts">$${200-available()} / $200 committed · $6 dead</span></section>`:`<div class="team-identity"><span class="team-monogram" aria-hidden="true">MC</span>${identity}</div>`;
 const content=empty?'<section class="card team-empty"><h2>No contracts to manage yet.</h2><p class="muted">Your players will appear after the draft.</p><button class="btn btn-primary" data-preview="Draft">Open Draft</button></section>':`<div class="roster-controls">${controls()}</div><section class="team-roster" aria-label="Roster">${list()}</section><footer class="team-footer"><nav aria-label="Related"><button class="text-action" data-preview="Trades">Trades <span aria-hidden="true">↗</span></button><button class="text-action" data-preview="Team appearance">Team appearance <span aria-hidden="true">↗</span></button></nav>${money()?'<details><summary>Contract rules</summary><p>Commissioners manage salary and contract terms. Eligible final-year deals can queue an extension before the draft.</p><p>This league keeps 50% of a cut player’s salary as dead cap, rounded down, for this season only.</p></details>':''}</footer>`;
 page.innerHTML=`<nav class="team-view" aria-label="My team view"><button data-preview="Room · existing team room">Room</button><button aria-pressed="true">Manage roster</button></nav><aside class="team-sidebar" aria-label="Your team">${overview}</aside><div class="team-main">${content}</div>`;
 const input=document.getElementById('roster-search');
 if(input){input.value=search;input.addEventListener('input',event=>{search=event.target.value;page.querySelector('.team-roster').innerHTML=list();});}
}
function frame(title,subtitle,content,actions){
 sheet.innerHTML=`<div class="sheet-shell"><header class="sheet-head"><div><h2 id="contract-title" tabindex="-1">${title}</h2><p>${subtitle}</p></div><button class="sheet-close" data-close aria-label="Close player details">×</button></header><div class="sheet-content">${content}</div><footer class="sheet-actions">${actions}</footer></div>`;
}
function details(){
 const p=selected;
 frame(p.name,`${p.pos} · ${p.team}`,money()?`<p class="contract-kind">${p.kind}</p><dl class="contract-facts"><div><dt>2026 cap hit</dt><dd>$${p.salary}</dd></div><div><dt>Years left</dt><dd>${years(p)}</dd></div></dl>${status(p)}<h3>Salary by season</h3><ul class="salary-schedule">${Array.from({length:years(p)},(_,i)=>`<li><span>${2026+i}</span><b>$${p.salary+(p.kind==='Extension'?i*5:0)}</b></li>`).join('')}</ul><details><summary>Contract history</summary><p class="sheet-note">Signed at the 2025 draft · ${p.kind}.</p></details>`:'<p class="sheet-note">Rostered on Sunday Roster.</p><button class="text-action" data-preview="This Week · player lineup">View in This Week ↗</button>',
 `<button class="btn btn-ghost" data-preview="Trades · ${p.name}">Trade</button>${money()?scenario==='pre'&&p.pre==='eligible'?'<button class="btn btn-primary" data-extend>Review extension</button>':'<button class="cut-button" data-cut>Cut player</button>':'<button class="btn btn-ghost" data-preview="Player details">Player profile</button>'}`);
}
function showPlayer(id){
 selected=roster.find(p=>p.id===id);if(!selected)return;
 details();sheet.showModal();sheet.querySelector('h2').focus();
}
sheet.addEventListener('click',event=>{
 if(event.target.closest('[data-close]'))sheet.close();
 if(event.target.closest('[data-back]')){details();sheet.querySelector('h2').focus();}
 if(event.target.closest('[data-cut]')){
  const dead=Math.floor(selected.salary*.5),freed=selected.salary-dead;
  frame(`Cut ${selected.name}?`,'Review before confirming',`<p>${scenario==='pre'&&selected.pre?`Adds <strong>$${dead}</strong> in dead cap for 2026.`:`Frees <strong>$${freed}</strong> now. <strong>$${dead}</strong> dead cap remains in 2026.`}</p><p class="sheet-note">The cut takes effect immediately.</p>`, `<button class="btn btn-ghost" data-back>Keep player</button><button class="cut-button" data-preview="Confirm Cut · ${selected.name}">Cut player</button>`);sheet.querySelector('h2').focus();
 }
 if(event.target.closest('[data-extend]'))renderExtension();
 const year=event.target.closest('[data-years]');if(year){extensionYears=Number(year.dataset.years);renderExtension();sheet.querySelector(`[data-years="${extensionYears}"]`).focus();}
 if(event.target.closest('[data-preview]'))sheet.close();
});
function renderExtension(){
 const p=selected,start=p.salary+5;
 frame(`Extend ${p.name}`,`Starts at $${start}`,`<div class="extension-years" role="group" aria-label="Extension length">${[1,2,3].map(n=>`<button data-years="${n}" aria-pressed="${extensionYears===n}">${n} ${n===1?'year':'years'}</button>`).join('')}</div><ul class="salary-schedule">${Array.from({length:extensionYears},(_,i)=>`<li><span>${2026+i}</span><b>$${start+i*5}</b></li>`).join('')}</ul><p class="sheet-note">Activates when the draft is marked complete. You can undo it before then.</p>`,`<button class="btn btn-ghost" data-back>Back</button><button class="btn btn-primary" data-preview="Queue extension · ${p.name}">Queue extension</button>`);
}
page.addEventListener('click',event=>{
 const player=event.target.closest('[data-player]');if(player)showPlayer(player.dataset.player);
 if(event.target.closest('[data-search]')){searchOpen=!searchOpen;if(!searchOpen)search='';render();(page.querySelector('#roster-search')||page.querySelector('[data-search]')).focus();}
 const pos=event.target.closest('[data-filter]');if(pos){filter=pos.dataset.filter;render();page.querySelector(`[data-filter="${filter}"]`).focus();}
});
document.querySelectorAll('[data-scenario]').forEach(button=>button.addEventListener('click',()=>{
 scenario=button.dataset.scenario;filter='ALL';search='';searchOpen=false;
 document.querySelectorAll('[data-scenario]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));render();
}));
render();
