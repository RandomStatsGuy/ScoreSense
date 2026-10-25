import {launchReleaseBrowser,releaseOutputRoot} from './release_browser.mjs';
import {measureScript,NUMERIC_RE,BAR_CONTROL_SELECTOR,TABLE_DEAD_ZONE_PX,COLUMN_PACK_RATIO,GUTTER_EDGE_SELECTORS} from './layout_audit.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),out=releaseOutputRoot(root),stage='shared';
const folder=path.join(out,stage+'-survey');await fs.mkdir(folder,{recursive:true});
const require=createRequire(path.join(root,'frontend/package.json')),{build}=require('esbuild');
const cases=[];
const add=(id,fixture,query={},ready='main',action)=>cases.push({id,fixture,query,ready,action});
for(const view of ['strategy','cap','vibes','week','draft','rules','agents'])add(view,'fantasy-spacing',{view},'[data-fixture-view]');
for(const tab of ['members','access','current','historic','corrections'])add('office-'+tab,'fantasy-spacing',{view:'office',tab},'.hub-league-office');
add('home','fantasy-home',{state:'pregame'},'.hub-home-clubhouse');
add('my-team','team-room',{state:'pregame'},'.team-room-heading');
add('rosters','rosters',{spacing:'1'},'.rosters-table');
add('trades','trades-transfers',{state:'salary'},'.hub-trade-desk');
add('insights','insights-hosts',{host:'native',format:'salary'},'.hub-insights-page');
add('dfs','dfs-workspace',{},'.dfw-workspace');
add('live-draft','draft-room',{},'.hub-draft-room');
for(const view of ['weekly','season','bestball','accuracy','mock','setup','landing','landing-projections','landing-fantasy','landing-tools','privacy','terms','sms'])add(view,'app-spacing',{view});
for(const view of ['account','report','admin','login','register','forgot','reset','lobby','create'])add(view,'supporting-pages',{view,state:'ready'},view==='create'?'#root':'main',view==='create'?'create':null);
add('player-details','player-card',{},'main','player');
add('weekly-command','supporting-pages',{view:'week',state:'ready'});
add('draft-entry','app-spacing',{view:'entry'});
add('alerts','app-spacing',{view:'alerts'});
cases.find(c=>c.id==='cap').fixture='cap-planner';cases.find(c=>c.id==='cap').query={};cases.find(c=>c.id==='cap').ready='.cap-planner-page';
const fixtures=[...new Set(cases.filter(c=>['strategy','cap','bestball','setup','draft','weekly-command','draft-entry','alerts','home'].includes(c.id)).map(x=>x.fixture))];
await build({absWorkingDir:root,entryPoints:fixtures.map(f=>`frontend/test-fixtures/${f}.jsx`),bundle:true,jsx:'automatic',format:'esm',outdir:path.join(folder,'bundles'),logLevel:'error',resolveExtensions:['.mjs','.js','.jsx','.json'],external:['/art/*','/fonts/*','/assets/*'],loader:{'.js':'jsx','.svg':'dataurl','.png':'dataurl','.webp':'dataurl','.woff2':'dataurl','.jpg':'dataurl'},define:{'process.env.NODE_ENV':'"production"','import.meta.env':JSON.stringify({DEV:false,PROD:true,MODE:'test',BASE_URL:'/'})}});
const server=createServer(async(req,res)=>{try {
 const u=new URL(req.url,'http://127.0.0.1'),match=u.pathname.match(/^\/test-fixtures\/([\w-]+)\.html$/),bundle=u.pathname.match(/^\/bundles\/([\w-]+)\.(js|css)$/);
 if(match&&fixtures.includes(match[1])){res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/bundles/${match[1]}.css"><script src="/theme-init.js"></script></head><body><div id="root"></div><script type="module" src="/bundles/${match[1]}.js"></script></body></html>`);return;}
 if(bundle&&fixtures.includes(bundle[1])){res.setHeader('Content-Type',bundle[2]==='js'?'text/javascript':'text/css');res.end(await fs.readFile(path.join(folder,'bundles',bundle[1]+'.'+bundle[2])));return;}
 const pub=path.join(root,'frontend/public'),asset=path.resolve(pub,'.'+u.pathname);
 if(asset.startsWith(pub+path.sep)&&/\.(png|svg|webp|woff2?|ttf|js|css)$/.test(asset)){const type={'.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2','.js':'text/javascript','.css':'text/css'};res.setHeader('Content-Type',type[path.extname(asset)]||'application/octet-stream');res.end(await fs.readFile(asset));return;}
 res.writeHead(404);res.end();
}catch{res.writeHead(404);res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`,browser=await launchReleaseBrowser(),reports=[];
const only=process.argv.find(a=>a.startsWith('--only='))?.slice(7).split(',');
const selected=cases.filter(c=>['strategy','cap','bestball','setup','draft','weekly-command','draft-entry','alerts','home'].includes(c.id));
const jobs=selected.flatMap(c=>[1280,390].flatMap(width=>['dark','light'].map(theme=>({...c,width,theme}))));
for(const c of selected.filter(c=>['setup','cap'].includes(c.id)))for(const width of [320,1024])jobs.push({...c,width,theme:'dark'});let next=0;
try {
 async function worker(){while(next<jobs.length){const c=jobs[next++],page=await browser.newPage({viewport:{width:c.width,height:900},serviceWorkers:'block',reducedMotion:'reduce'}),errors=[];page.setDefaultTimeout(10000);page.setDefaultNavigationTimeout(60000);page.on('pageerror',e=>errors.push(e.message));
  const report={...c,errors};
  try {
   await page.addInitScript(theme=>localStorage.setItem('scoresense-color-theme',theme),c.theme);
   await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin!==base||u.pathname.startsWith('/api/'))return route.abort();return route.continue();});
   await page.goto(`${base}/test-fixtures/${c.fixture}.html?${new URLSearchParams({...c.query,theme:c.theme})}`,{waitUntil:'domcontentloaded'});
   await page.locator(c.ready).first().waitFor();
   if(c.action==='player')await page.getByRole('button',{name:'Open Josh Allen',exact:true}).click();
   if(c.action==='create')await page.getByRole('button',{name:'Open create or join',exact:true}).click();
   await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(120);
   assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),c.theme,'Requested theme must be active');
   report.geometry=await page.evaluate(()=>{
    const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width&&r.height&&s.visibility!=='hidden'&&s.display!=='none';};
    const box=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};};
    return {overflow:document.documentElement.scrollWidth>innerWidth,summaries:[...document.querySelectorAll('summary')].filter(visible).map(e=>({text:e.innerText.slice(0,160),classes:e.className,box:box(e),display:getComputedStyle(e).display,marker:getComputedStyle(e).listStyleType,before:getComputedStyle(e,'::before').content,after:getComputedStyle(e,'::after').content,children:[...e.children].map(c=>({tag:c.tagName,classes:c.className,box:box(c),display:getComputedStyle(c).display}))})),headings:[...document.querySelectorAll('h1,h2')].filter(visible).slice(0,12).map(e=>({text:e.innerText,classes:e.parentElement.className,box:box(e),parent:box(e.parentElement)})),stacks:[...document.querySelectorAll('[data-layout-stack],.hub-page,.standalone-page')].filter(visible).map(e=>({classes:e.className,gap:getComputedStyle(e).rowGap,children:[...e.children].filter(visible).slice(0,16).map(c=>({classes:c.className,tag:c.tagName,box:box(c)}))}))};
   });
   report.spacing=await page.evaluate(()=>{
    const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'&&!['absolute','fixed'].includes(s.position);};
    return [...document.querySelectorAll('[data-layout-stack]')].filter(visible).map(e=>{const gap=parseFloat(getComputedStyle(e).rowGap),children=[...e.children].filter(visible),gaps=children.slice(1).map((n,i)=>n.getBoundingClientRect().top-children[i].getBoundingClientRect().bottom);return {classes:e.className,gap,gaps,ok:gaps.every(n=>Math.abs(n-gap)<1)};});
   });
   const lateStyle=await page.addStyleTag({content:'.hub-section, .hub-setup-panel, .bestball-legend, .hub-strategy-progress { margin-block:12px; } .hub-setup--mobile .hub-setup-panel {margin-bottom:10.4px;} .hub-experience-main .hub-section, .hub-experience-main .bestball-legend {margin-block:12px;}'});
   report.lateStyleStable=await page.evaluate(()=>[...document.querySelectorAll('[data-layout-stack]')].every(e=>{
    const visible=n=>{const r=n.getBoundingClientRect(),s=getComputedStyle(n);return r.width&&r.height&&s.visibility!=='hidden'&&!['absolute','fixed'].includes(s.position);};
    const nodes=[...e.children].filter(visible),gap=parseFloat(getComputedStyle(e).rowGap);
    return nodes.slice(1).every((n,i)=>Math.abs(n.getBoundingClientRect().top-nodes[i].getBoundingClientRect().bottom-gap)<1);
   }));
   await lateStyle.evaluate(e=>e.remove());
   assert.ok(report.lateStyleStable,'Later page styles must not add margins to stack children');
   report.audit=await page.evaluate(measureScript(),{minTarget:c.width<=768?44:32,numericRe:NUMERIC_RE.source,barControlSelector:BAR_CONTROL_SELECTOR,tableDeadZonePx:TABLE_DEAD_ZONE_PX,columnPackRatio:COLUMN_PACK_RATIO,gutterSelectors:GUTTER_EDGE_SELECTORS});
   if(c.id==='strategy')assert.equal(await page.locator('.hub-alert-stack').count(),0,'Empty conditional alerts must not leave a spacer');
   if(c.id==='alerts'){assert.equal(await page.locator('.hub-alert-stack').count(),1);assert.equal(await page.getByText('A visible warning stays available.',{exact:true}).count(),1);}
   if(c.id==='setup'){
    const summary=page.locator('.hub-setup-accordion > summary').last();
    await summary.focus();await page.keyboard.press('Enter');assert.equal(await summary.evaluate(e=>e.parentElement.open),true);
    assert.equal(await summary.evaluate(e=>getComputedStyle(e).display),'list-item');
    assert.equal(await summary.locator('.hub-inline-disclosure__toggle').evaluate(e=>getComputedStyle(e,'::before').content),'"−"');
    await page.keyboard.press('Space');assert.equal(await summary.evaluate(e=>e.parentElement.open),false);
   }
   assert.ok(!report.geometry.overflow,'No horizontal page overflow');
   assert.ok(report.spacing.every(x=>x.ok),'Stack spacing mismatch: '+JSON.stringify(report.spacing.filter(x=>!x.ok)));
   if(c.id==='strategy'){
    const cards=page.locator('.hub-strategy-card'), undo=page.getByRole('button',{name:'Undo',exact:true});
    const names=()=>page.locator('.hub-strategy-card .hub-strategy-name').allTextContents();
    const original=await names();assert.equal(await cards.count(),2);
    assert.equal(await page.locator('.hub-strategy .btn-primary').count(),0,'Choices and browse navigation retain quiet equal weight');
    for(const side of [0,1]){await cards.nth(side).getByRole('button',{name:/Rank .* higher/}).click();await assert.doesNotReject(()=>undo.waitFor());assert.equal(await undo.isEnabled(),true);await undo.click();assert.deepEqual(await names(),original);}
    await page.locator('.hub-strategy-kicker').click();await page.keyboard.press('ArrowLeft');assert.equal(await undo.isEnabled(),true);await undo.click();assert.deepEqual(await names(),original);
    await page.getByRole('button',{name:'Skip',exact:true}).click();assert.equal(await undo.isEnabled(),true);await undo.click();assert.deepEqual(await names(),original);
    await page.getByRole('button',{name:'View my rankings',exact:true}).click();await page.getByRole('button',{name:'Back to close calls',exact:true}).click();assert.deepEqual(await names(),original);
    assert.equal(await page.evaluate(()=>window.fixtureWrites.length),0);report.strategyInteractions='both choices, undo, keyboard, skip, rankings/back; no writes';
   }
   report.screenshot=`${c.id}-${c.width}-${c.theme}.png`;await page.screenshot({path:path.join(folder,report.screenshot),fullPage:true,animations:'disabled'});
   report.status=errors.length?'runtime-error':'rendered';
  }catch(e){report.status='unavailable';report.error=e.message.split('\n')[0];report.content=(await page.locator('body').innerText().catch(()=>'' )).slice(0,400);}
  reports.push(report);await page.close();console.log(`${c.id} ${c.width} ${c.theme}: ${report.status}${report.geometry?.overflow?' OVERFLOW':''}`);
 }}
 await Promise.all([worker(),worker(),worker(),worker()]);
}finally{await fs.writeFile(path.join(folder,'report.json'),JSON.stringify(reports,null,2));await browser.close();await new Promise(resolve=>server.close(resolve));}

if(reports.some(r=>r.status!=="rendered"))process.exitCode=1;
