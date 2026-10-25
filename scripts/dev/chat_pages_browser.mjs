// Real Fantasy controls across scroll, with isolated synthetic data and no league writes.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {measureScript,NUMERIC_RE,BAR_CONTROL_SELECTOR,TABLE_DEAD_ZONE_PX,COLUMN_PACK_RATIO,GUTTER_EDGE_SELECTORS} from './layout_audit.mjs';
import {LIVING_SURFACES} from '../../frontend/src/livingSurfaces.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const folder=path.join(root,'outputs/agent/release-regressions/chat-pages');await fs.mkdir(folder,{recursive:true});
const require=createRequire(path.join(root,'frontend/package.json')),{build}=require('esbuild'),{chromium}=require('playwright');
const specs=[
 {id:'strategy',surface:'hub.value',fixture:'fantasy-spacing',query:{view:'strategy'},ready:'.hub-strategy-take'},
 {id:'rules',surface:'hub.rules',fixture:'fantasy-spacing',query:{view:'rules'},ready:'.hub-rules-field-grid input'},
 {id:'members',surface:'hub.office.members',fixture:'fantasy-spacing',query:{view:'office',tab:'members'},ready:'.hub-office-members'},
 {id:'access',surface:'hub.office.access',fixture:'fantasy-spacing',query:{view:'office',tab:'access'},ready:'.hub-office-access'},
 {id:'vibes',surface:'hub.vibes',fixture:'fantasy-spacing',query:{view:'vibes'},ready:'.hub-vibes-card'},
 {id:'cap',surface:'hub.planner',fixture:'cap-planner',query:{chat:'1'},ready:'.cap-planner-player'},
 {id:'game',surface:'hub.game',fixture:'game-center',query:{chat:'1',state:'pregame'},ready:'.gc-room-position-strip'},
 {id:'rosters',surface:'hub.rosters',fixture:'rosters',query:{chat:'1'},ready:'.rosters-table'},
 {id:'room',surface:'hub.roster',fixture:'team-room',query:{state:'pregame'},ready:'.team-room-wall'},
 {id:'trades',surface:'hub.trades',fixture:'trades-transfers',query:{state:'salary',chat:'1'},ready:'.hub-trade-faceoff'},
 {id:'corrections',surface:'hub.office.corrections',fixture:'corrections',query:{chat:'1'},ready:'.correction-workspace'},
];
specs.push(
 {...specs.find(s=>s.id==='strategy'),id:'rankings',action:'rankings'},
 {...specs.find(s=>s.id==='rules'),id:'rules-format',action:'rules-format'},
 {...specs.find(s=>s.id==='rules'),id:'rules-roster',action:'rules-roster'},
 {...specs.find(s=>s.id==='access'),id:'access-expanded',action:'access-expanded'},
 {...specs.find(s=>s.id==='room'),id:'player-details',action:'player-details'},
 {id:'contracts',surface:'hub.office.current',fixture:'fantasy-spacing',query:{view:'office',tab:'current'},ready:'.hub-league-rosters',action:'contracts'},
 {id:'bulk-audit',surface:'hub.office.historic',fixture:'fantasy-spacing',query:{view:'office',tab:'historic'},ready:'.hub-office-advanced'},
);
specs.push({id:'setup',surface:'hub.setup',fixture:'app-spacing',query:{view:'setup',chat:'1'},ready:'.hub-setup'});
specs.push({...specs.find(s=>s.id==='contracts'),id:'contracts-awards',action:'contracts-awards'});
specs.push(...[['rules-contracts','Contracts'],['rules-draft','Draft behavior'],['rules-managers','Manager names']].map(([id,category])=>({...specs.find(s=>s.id==='rules'),id,category,action:'rules-category'})));
specs.push(...[
 ['insights-overview','overview'],['insights-contracts','contracts'],['insights-spend','cap'],['insights-scoring','scoring'],['insights-history','ownership'],
 ['insights-spend-expanded','cap','insights-expand'],['insights-scoring-expanded','scoring','insights-expand'],['insights-period-expanded','overview','insights-period'],
].map(([id,tab,action])=>({id,surface:'hub.insights',fixture:'insights-history',query:{chat:'1',linked:'1',tab},ready:tab==='ownership'?'.hub-insights-player-btn':tab==='contracts'?'.hub-insights-contract-list li':tab==='scoring'?'.hub-insights-score-row':tab==='cap'?'.hub-insights-spend-row':'.hub-insights-record-book',action})));
const servedSpecs=[...specs,{id:'free-agents',surface:'hub.available',fixture:'free-agents-mobile',query:{state:'bid',chat:'1'},ready:'.fa-acquire'}];
const fixtures=[...new Set(servedSpecs.map(s=>s.fixture))];
await build({absWorkingDir:root,entryPoints:fixtures.map(f=>`frontend/test-fixtures/${f}.jsx`),bundle:true,jsx:'automatic',format:'esm',outdir:path.join(folder,'bundles'),logLevel:'error',resolveExtensions:['.mjs','.js','.jsx','.json'],external:['/art/*','/fonts/*','/assets/*'],loader:{'.js':'jsx','.svg':'dataurl','.png':'dataurl','.webp':'dataurl','.woff2':'dataurl','.jpg':'dataurl'},define:{'process.env.NODE_ENV':'"production"','import.meta.env':JSON.stringify({DEV:false,PROD:true,MODE:'test',BASE_URL:'/'})}});
const server=createServer(async(req,res)=>{try{
 const u=new URL(req.url,'http://127.0.0.1'),spec=servedSpecs.find(s=>LIVING_SURFACES[s.surface].route===u.pathname),bundle=u.pathname.match(/^\/bundles\/([\w-]+)\.(js|css)$/);
 if(spec){res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/bundles/${spec.fixture}.css"><script src="/theme-init.js"></script></head><body><div id="root"></div><script>history.replaceState(null,"",${JSON.stringify(u.pathname+'?'+new URLSearchParams({...spec.query,...Object.fromEntries(u.searchParams)}))})</script><script type="module" src="/bundles/${spec.fixture}.js"></script></body></html>`);return;}
 if(bundle&&fixtures.includes(bundle[1])){res.setHeader('Content-Type',bundle[2]==='js'?'text/javascript':'text/css');res.end(await fs.readFile(path.join(folder,'bundles',bundle[1]+'.'+bundle[2])));return;}
 const pub=path.join(root,'frontend/public'),asset=path.resolve(pub,'.'+u.pathname);
 if(asset.startsWith(pub+path.sep)&&/\.(png|svg|webp|woff2?|ttf|js|css)$/.test(asset)){res.setHeader('Content-Type',({'.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2','.js':'text/javascript','.css':'text/css'})[path.extname(asset)]||'application/octet-stream');res.end(await fs.readFile(asset));return;}
 res.writeHead(404);res.end();
}catch{res.writeHead(404);res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
await fs.writeFile(path.join(folder,'base.txt'),base);
if(process.argv.includes('--serve')){console.log('Chat-enabled canonical route fixtures ready.');process.stdin.resume();process.stdin.on('data',()=>server.close(()=>process.exit(0)));}
else {
 const browser=await chromium.launch({headless:true,channel:process.env.RELEASE_BROWSER_CHANNEL||(process.platform==='win32'?'msedge':'chromium'),args:['--no-proxy-server']}),reports=[];
 const args={numericRe:NUMERIC_RE.source,barControlSelector:BAR_CONTROL_SELECTOR,tableDeadZonePx:TABLE_DEAD_ZONE_PX,columnPackRatio:COLUMN_PACK_RATIO,gutterSelectors:GUTTER_EDGE_SELECTORS};
 const jobs=specs.flatMap(spec=>[320,390,1280,1440].flatMap(width=>['dark','light'].map(theme=>({...spec,width,theme}))));let next=0;
 const only=process.argv.find(a=>a.startsWith('--only='))?.slice(7).split(',');const selected=only?jobs.filter(j=>only.includes(j.id)):jobs;
 async function worker(){while(next<selected.length){
  const c=selected[next++],id=`${c.id}-${c.width}-${c.theme}`,page=await browser.newPage({viewport:{width:c.width,height:900},serviceWorkers:'block',reducedMotion:'reduce'}),errors=[];let report={id,route:LIVING_SURFACES[c.surface].route};
  page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(12000);
  try{
   await page.addInitScript(theme=>localStorage.setItem('scoresense-color-theme',theme),c.theme);
   await page.route('**/*',r=>new URL(r.request().url()).origin===base&&!new URL(r.request().url()).pathname.startsWith('/api/')?r.continue():r.abort());
   await page.goto(base+report.route+'?'+new URLSearchParams({...c.query,theme:c.theme}),{waitUntil:'domcontentloaded'});await page.locator(c.ready).first().waitFor();await page.locator('.fantasy-chat-bubble-a').waitFor();await page.evaluate(()=>document.fonts.ready);
   await page.addStyleTag({content:'html{scroll-behavior:auto!important}'});
   if(c.id==='rosters'){await page.getByRole('tab',{name:'Team rosters',exact:true}).click();await page.locator('.rosters-team-card').first().waitFor();}
   if(c.action==='rankings')await page.getByRole('button',{name:'View my rankings',exact:true}).click();
   if(c.action==='rules-format')await page.getByRole('button',{name:'League format',exact:true}).click();
   if(c.action==='rules-roster')await page.getByRole('button',{name:'Roster limits',exact:true}).click();
   if(c.action==='access-expanded')for(const summary of await page.locator('.hub-office-access-disclosure > summary').all())await summary.click();
   if(c.action==='player-details'){await page.getByRole('button',{name:/^(Manage roster|Player details)$/}).click();await page.locator('.my-team-roster').waitFor();}
   if(c.action==='contracts'){
    if(c.width<=768){await page.getByRole('button',{name:/^Team to edit:/}).click();await page.getByRole('option',{name:'Maya Chen',exact:true}).click();}
    else await page.locator('.hub-league-jump-pill').first().click();
    await page.locator('.hub-league-search input').waitFor();
   }
   if(c.action==='rules-category'){await page.getByRole('button',{name:c.category,exact:true}).click();if(c.category==='Manager names')await page.locator('.hub-manager-names input').first().waitFor();}
   if(c.action==='contracts-awards')await page.locator('.hub-office-award-disclosure > summary').click();
   if(c.id.startsWith('insights-')&&c.width===320){
    const tabs=page.locator('.hub-insights-tabs');
    assert.ok(await tabs.evaluate(e=>{const a=e.querySelector('[aria-current="true"]'),r=a.getBoundingClientRect(),b=e.getBoundingClientRect();return r.left>=b.left-1&&r.right<=b.right+1;}),'active narrow tab is fully visible');
    if(c.id==='insights-overview'&&c.theme==='dark'){
     const before=await page.evaluate(()=>scrollY);
     await tabs.getByRole('button',{name:'History',exact:true}).click();await page.locator('.hub-insights-player-btn').first().waitFor();
     assert.equal(await page.evaluate(()=>scrollY),before,'changing tabs does not move the page vertically');
     await tabs.getByRole('button',{name:'Overview',exact:true}).click();await page.locator('.hub-insights-record-book').waitFor();
    }
   }
   if(c.action==='insights-expand')for(const summary of await page.locator('main details:not(.hub-insights-period) > summary').all())if(await summary.isVisible())await summary.click();
   if(c.action==='insights-period')await page.locator('.hub-insights-period > summary').click();
   const audit=()=>page.evaluate(measureScript(),{...args,minTarget:c.width<=768?44:32});
   if(c.id==='cap'&&c.width<=768){
    await page.addStyleTag({content:'.app-header--hub .app-header-mobile-top--league {grid-template-columns:fit-content(55%) minmax(0,1fr);gap:var(--space-3);padding:var(--space-2);}'});
    assert.ok(await page.locator('.app-header-shell').evaluate(e=>e.getBoundingClientRect().height<=72),'phone header stays compact after late phone styles');
   }
   if(c.id==='setup'&&c.width===320){
    const title=page.locator('.hub-inline-disclosure__identity').filter({hasText:'Sleeper connection'});
    const titleMetrics=await title.evaluate(e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return {width:r.width,height:r.height,lineHeight:s.lineHeight,fontSize:s.fontSize};});
    assert.ok(titleMetrics.height<=3*(parseFloat(titleMetrics.lineHeight)||parseFloat(titleMetrics.fontSize)*1.2),`narrow disclosure title retains readable words within three lines: ${JSON.stringify(titleMetrics)}`);
   }
   if(c.id.startsWith('insights-')&&c.width<=768)assert.deepEqual((await audit()).filter(x=>['insights-mobile','insights-tabs'].includes(x.rule)&&!x.ok),[],'phone Insights controls retain the approved row and balanced tab insets');
   const max=await page.evaluate(()=>document.documentElement.scrollHeight-innerHeight),samples=[];
   for(let y=0;y<=max+200;y+=200){await page.evaluate(y=>scrollTo(0,y),Math.min(y,max));const checks=await audit();const failures=checks.filter(x=>['overlay-clearance','chat-anchor','overflow'].includes(x.rule)&&!x.ok);assert.deepEqual(failures,[],`scroll ${y}: ${JSON.stringify(failures)}`);samples.push(Math.min(y,max));}
   // Scroll every horizontally at-risk control through chat, including unmarked ones.
   // Fixed 200px samples alone can skip a short summary or pagination button.
   let alignedActions=0;
   for(const control of await page.locator('main button,main a[href],main summary,main input,main select,main textarea,main [role="button"],main [role="tab"]').all()){
    const moved=await control.evaluate(e=>{if(!e.checkVisibility())return false;const b=document.querySelector('.fantasy-chat-launcher-a').getBoundingClientRect(),r=e.getBoundingClientRect();if(!r.width||!r.height||r.right<=b.left+1)return false;const y=scrollY+r.top+r.height/2-b.top-b.height/2;if(y<0)return false;scrollTo(0,y);return true;});
    if(moved){const failures=(await audit()).filter(x=>['overlay-clearance','chat-anchor','overflow'].includes(x.rule)&&!x.ok);assert.deepEqual(failures,[],`aligned interactive control: ${JSON.stringify(failures)}`);alignedActions++;}
   }
   report.alignedActions=alignedActions;
   report.scrollSamples=samples.length;
   if(c.id==='strategy'&&c.width===320){
    await page.evaluate(()=>{const d=document.createElement('details');d.id='closed-overlay-proof';d.dataset.chatSafeActions='';d.innerHTML='<summary>Hidden-control proof</summary><button style="position:fixed;right:16px;bottom:calc(var(--bottom-nav-height) + 16px);width:44px;height:44px">Proof</button>';document.querySelector('main').append(d);});
    assert.ok((await audit()).filter(x=>x.rule==='overlay-clearance').every(x=>x.ok),'closed disclosure content does not paint');
    await page.locator('#closed-overlay-proof').evaluate(e=>e.open=true);
    assert.ok((await audit()).some(x=>x.rule==='overlay-clearance'&&!x.ok),'open disclosure control in the same rectangle is rejected');
    await page.locator('#closed-overlay-proof').evaluate(e=>e.remove());
   }
   const panelFits=await page.locator('[data-bottom-actions] button').evaluateAll((buttons,min)=>buttons.every(e=>{if(!e.checkVisibility())return true;const r=e.getBoundingClientRect();return r.height>=min-.5 && r.width>=min-.5 && e.scrollWidth<=e.clientWidth+1 && e.scrollHeight<=e.clientHeight+1;}),c.width<=768?44:32);
   assert.equal(panelFits,true,'sticky action labels and targets remain readable');
   // Align a protected target with chat. Removing its shared lane must restore a collision.
   const candidates=await page.locator('[data-chat-safe-actions] button,[data-chat-safe-actions] input,[data-chat-safe-actions] summary,button[data-chat-safe-actions],summary[data-chat-safe-actions]').count();
   let negative=false;
   for(let i=0;i<candidates&&!negative;i++){
    const candidate=page.locator('[data-chat-safe-actions] button,[data-chat-safe-actions] input,[data-chat-safe-actions] summary,button[data-chat-safe-actions],summary[data-chat-safe-actions]').nth(i);
    if(!await candidate.isVisible())continue;
    const unsafe=await page.addStyleTag({content:':root.has-fantasy-chat-launcher [data-chat-safe-actions],:root.has-fantasy-chat-launcher [data-chat-safe-row]{padding-inline-end:0!important;margin-inline-end:0!important;max-inline-size:none!important}'});
    await candidate.evaluate(e=>{const b=document.querySelector('.fantasy-chat-launcher-a').getBoundingClientRect(),r=e.getBoundingClientRect();scrollBy(0,r.top+r.height/2-b.top-b.height/2);});
    negative=(await audit()).some(x=>x.rule==='overlay-clearance'&&!x.ok);
    await unsafe.evaluate(e=>e.remove());
    if(negative){await candidate.evaluate(e=>{const b=document.querySelector('.fantasy-chat-launcher-a').getBoundingClientRect(),r=e.getBoundingClientRect();scrollBy(0,r.top+r.height/2-b.top-b.height/2);});assert.ok((await audit()).filter(x=>['overlay-clearance','chat-anchor'].includes(x.rule)).every(x=>x.ok),'restoring shared lane clears chat');}
   }
   // Some desktop content is already left of chat (for example the Rules main column).
   if(c.width<=390&&!['rankings','rules-roster','insights-overview','insights-period-expanded'].includes(c.id))assert.equal(negative,true,'phone negative control recreates the original overlap');
   report.negativeControl=negative;
   report.screenshot=id+'.png';await page.screenshot({path:path.join(folder,report.screenshot)});
   await page.locator('.fantasy-chat-bubble-a').click();await page.getByRole('dialog').waitFor();await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});
   assert.ok((await audit()).filter(x=>x.rule==='chat-anchor').every(x=>x.ok),'chat returns to fixed anchor');
   await page.locator('.fantasy-chat-bubble-a').press('Delete');await page.locator('.fantasy-chat-hide-a').click();await page.locator('.fantasy-chat-bubble-a').waitFor({state:'hidden'});
   assert.equal(await page.evaluate(()=>document.documentElement.classList.contains('has-fantasy-chat-launcher')),false,'dismissal releases the shared lane');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no horizontal overflow after dismissal');
   assert.deepEqual(await page.evaluate(()=>window.chatAuditWrites||window.fixtureWrites||[]),[],'audit does not save league changes');assert.deepEqual(errors,[]);
   report.status='pass';
  }catch(e){report.status='fail';report.error=e.message;await page.screenshot({path:path.join(folder,id+'-fail.png')}).catch(()=>{});}
  reports.push(report);console.log(id,report.status,report.error||'');await page.close();
 }}
 try{await Promise.all([worker(),worker(),worker()]);}finally{await fs.writeFile(path.join(folder,'report.json'),JSON.stringify(reports,null,2));await browser.close();await new Promise(resolve=>server.close(resolve));}
 if(reports.some(r=>r.status!=='pass'))process.exitCode=1;
}
