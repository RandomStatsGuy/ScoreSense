// Illustrative design data only. Controls never write to a league.
const starters = [
 ['QB','Josh Allen','BUF · Sun 1:00',21.6,'Jalen Hurts',20.1],
 ['RB','Bijan Robinson','ATL · Sun 1:00',16.1,'Saquon Barkley',15.2],
 ['RB','James Cook','BUF · Sun 1:00',12.4,'Breece Hall',11.8],
 ['WR','CeeDee Lamb','DAL · Sun 4:25',14.8,'Ja’Marr Chase',16.5],
 ['WR','Davante Adams','LAR · Sun 4:25',11.2,'Justin Jefferson',12.7,'Zay Flowers',3.2],
 ['TE','Trey McBride','ARI · Sun 4:05',10.3,'Brock Bowers',8.8],
 ['FLEX','Rachaad White','TB · Sun 1:00',10.8,'Nico Collins',9.6,'James Conner',2.3],
 ['K','Cameron Dicker','LAC · Sun 4:05',8.2,'Jake Elliott',7],
 ['DEF','Buffalo','Sun 1:00',7,'Philadelphia',7],
];
const bench = [['WR','Zay Flowers','BAL · Sun 1:00',14.4],['RB','James Conner','ARI · Sun 4:05',13.1],['QB','Baker Mayfield','TB · Sun 1:00',18.6],['TE','Dalton Kincaid','BUF · Sun 1:00',8.1]];
const main = document.querySelector('.week-shell');
let mode='native';
let panel=document.body.dataset.option==='b'?'matchup':'lineup';
const icon='<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M5 7h14M5 12h14M5 17h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
const player=(name,meta)=>`<span class="player"><strong>${name}</strong><small>${meta}</small></span>`;
function row(p,isBench=false){
 const [pos,name,meta,pts,,,replacement,delta]=p;
 const readonly=mode==='linked';
 const position=`<button class="position" data-preview="${readonly?'Sleeper lineup':isBench?`Existing position picker · choose a starter slot for ${name}`:`Existing ${pos} bench picker`}" aria-label="${isBench?'Start':'Change'} ${pos}: ${name}">${pos}</button>`;
 const action=replacement&&!isBench?`<button class="call-start" data-preview="${readonly?'Sleeper lineup':`Existing Ticket · sit ${name}, start ${replacement}`}" aria-label="Review ${replacement} for ${name}, plus ${delta} projected points">Start<span>+${delta.toFixed(1)}</span></button>`:'<span aria-hidden="true"></span>';
 return `<div class="slate-row">${position}${player(name,replacement?`<i class="sit-mark">Sit</i> · ${meta}`:meta)}<strong class="points">${pts.toFixed(1)}</strong>${isBench?'':action}</div>`;
}
function summary(){
 const missing=mode==='empty';
 if(document.body.dataset.option==='a')return `<div class="forecast-strip"><span>You <small>vs</small> Jordan</span><strong>${missing?'—':'112.4'}<small>—</small>${missing?'—':'108.7'}</strong><span>Projected</span></div>`;
 return `<section class="week-scoreboard" aria-label="Projected matchup"><div class="owner"><span class="owner-mark">MC</span><span>Maya · You</span><strong>${missing?'—':'112.4'}</strong><small class="meta">2–1</small></div><div class="score-context"><span>Projected</span><span>vs</span></div><div class="owner"><span class="owner-mark">JD</span><span>Jordan Davis</span><strong>${missing?'—':'108.7'}</strong><small class="meta">2–1</small></div></section>`;
}
function lineup(){
 if(mode==='empty')return '<section class="slate empty-lineup"><h1>Your lineup starts at the draft.</h1><p>Draft night · Not scheduled</p><button class="btn btn-primary" data-preview="Draft">Open draft room</button></section>';
 return `<div class="week-layout"><section class="slate"><header class="slate-head"><h1>Your starters</h1><span>Projected</span></header>${starters.map(p=>row(p)).join('')}</section><details class="card bench"><summary><span class="disclosure-heading"><span class="section-icon" aria-hidden="true">${icon}</span><span class="disclosure-title"><strong>Bench</strong><small>4 players</small></span><span class="disclosure-toggle" aria-hidden="true"></span></span></summary>${bench.map(p=>row(p,true)).join('')}</details></div>`;
}
function matchup(){
 if(mode==='empty')return '<section class="slate empty-lineup"><h1>Your matchup will appear here.</h1><p>Finish the draft to see your starters.</p><button class="btn btn-ghost" data-preview="Draft">Open draft room</button></section>';
 return `<section class="slate"><header class="slate-head"><h1>Your matchup</h1><span>Projected</span></header>${starters.map(p=>`<div class="match-row">${player(p[1],p[2].split(' · ')[0])}<strong class="points">${p[3].toFixed(1)}</strong><span class="position">${p[0]}</span><strong class="points">${p[5].toFixed(1)}</strong>${player(p[4],({'Jalen Hurts':'PHI','Saquon Barkley':'PHI','Breece Hall':'NYJ','Ja’Marr Chase':'CIN','Justin Jefferson':'MIN','Brock Bowers':'LV','Nico Collins':'HOU','Jake Elliott':'PHI','Philadelphia':'DEF'})[p[4]])}</div>`).join('')}</section>`;
}
function league(){return '<section class="slate"><header class="slate-head"><h1>Standings</h1><span>W–L</span></header><ol class="league-rows"><li><span>1 · Alex Morgan</span><strong>3–0</strong></li><li><span>2 · Sam Lee</span><strong>2–1</strong></li><li><span>3 · Maya Chen · You</span><strong>2–1</strong></li><li><span>4 · Jordan Davis</span><strong>2–1</strong></li></ol><button class="text-action" data-preview="Full league standings">All standings →</button></section>';}
function render(){
 main.innerHTML=`<div class="week-controls"><div class="week-stepper" aria-label="Week selection"><button data-preview="Previous week" aria-label="Previous week">‹</button><strong>Week 4</strong><button data-preview="Next week" aria-label="Next week">›</button></div><span class="call-count">${mode==='empty'?'Pre-draft':'2 lineup calls'}</span></div>${summary()}<nav class="week-tabs" aria-label="Week views">${['lineup','matchup','league'].map(id=>`<button data-panel="${id}" aria-pressed="${panel===id}">${id[0].toUpperCase()+id.slice(1)}</button>`).join('')}</nav><div id="week-panel">${panel==='lineup'?lineup():panel==='matchup'?matchup():league()}</div><div class="week-freshness"><span>${mode==='empty'?'':'Projections · 8 min ago'}</span>${mode==='empty'?'':'<button class="text-action" data-preview="Refresh projections">Refresh ↻</button>'}</div>${mode==='linked' && panel==='lineup'?'<div class="week-freshness"><button class="text-action" data-preview="Sleeper lineup">Manage in Sleeper ↗</button></div>':''}`;
 main.querySelectorAll('[data-panel]').forEach(button=>button.addEventListener('click',()=>{panel=button.dataset.panel;render();main.querySelector(`[data-panel="${panel}"]`).focus();}));
}
document.querySelectorAll('[data-mode]').forEach(button=>button.addEventListener('click',()=>{
 mode=button.dataset.mode;
 document.querySelectorAll('[data-mode]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));
 render();
}));
render();
