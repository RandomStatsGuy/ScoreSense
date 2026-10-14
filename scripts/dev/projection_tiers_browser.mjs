import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {measureScript,NUMERIC_RE,BAR_CONTROL_SELECTOR,TABLE_DEAD_ZONE_PX,COLUMN_PACK_RATIO,GUTTER_EDGE_SELECTORS} from './layout_audit.mjs';
const require=createRequire(new URL('../../frontend/package.json',import.meta.url));
const {build}=require('esbuild'),{chromium}=require('playwright');
const built=await build({entryPoints:[fileURLToPath(new URL('../../frontend/test-fixtures/projection-tiers.jsx',import.meta.url))],bundle:true,resolveExtensions:['.js','.jsx','.json'],jsx:'automatic',format:'esm',write:false,outdir:'outputs/projection-tiers-assets',external:['/art/*','/fonts/*'],define:{'process.env.NODE_ENV':'"production"','import.meta.env':'{"DEV":true,"PROD":false}'},loader:{'.woff2':'dataurl','.woff':'dataurl','.svg':'dataurl','.png':'dataurl'}});
const js=built.outputFiles.find(f=>f.path.endsWith('.js')).contents,css=built.outputFiles.find(f=>f.path.endsWith('.css')).contents;
const init=await fs.readFile(new URL('../../frontend/public/theme-init.js',import.meta.url),'utf8');
const html=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Projections tiers review</title><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script>${init}</script><script type="module" src="/fixture.js"></script></body></html>`;
const exportDir=process.argv.find(a=>a.startsWith('--export='))?.slice(9);
if(exportDir){await fs.mkdir(exportDir,{recursive:true});await Promise.all([fs.writeFile(`${exportDir}/index.html`,html.replaceAll('/fixture.','./fixture.')),fs.writeFile(`${exportDir}/fixture.js`,js),fs.writeFile(`${exportDir}/fixture.css`,css)]);await fs.writeFile(`${exportDir}/fixture-avatar.svg`,'<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" rx="48" fill="#243249"/><text x="48" y="56" font-family="sans-serif" font-size="24" text-anchor="middle" fill="#eef3fb">SS</text></svg>');if(process.argv.includes('--export-only'))process.exit(0);}
const server=createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname.endsWith('/fixture-avatar.svg')){res.setHeader('Content-Type','image/svg+xml');res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" rx="48" fill="#243249"/><text x="48" y="56" font-family="sans-serif" font-size="24" text-anchor="middle" fill="#eef3fb">${(url.searchParams.get('name')||'P').replace(/[^a-zA-Z]/g,'')}</text></svg>`);return;}
 res.setHeader('Content-Type',url.pathname.endsWith('.js')?'text/javascript':url.pathname.endsWith('.css')?'text/css':'text/html');res.end(url.pathname==='/fixture.js'?js:url.pathname==='/fixture.css'?css:html);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`,out='outputs/projection-tiers-review';await fs.mkdir(out,{recursive:true});
let browser=await chromium.launch({headless:true});const requestedView=process.argv.find(a=>a.startsWith('--view='))?.slice(7);
const requestedStates=process.argv.find(a=>a.startsWith('--states='))?.slice(9).split(',');
const reports=process.argv.includes('--append')?JSON.parse(await fs.readFile(`${out}/audit.json`,'utf8')).filter(r=>r.view!==requestedView||(requestedStates&&!requestedStates.includes(r.state)&&!(requestedStates.includes('ready')&&['recorded','card-details'].includes(r.state))&&!(requestedStates.includes('bye')&&r.state==='bye-card'))):[];
try {
 const views=requestedView?[requestedView]:process.argv.includes('--smoke')?['weekly']:['weekly','preseason','live'];
 const states=requestedStates|| (process.argv.includes('--smoke')?['ready']:['ready','large','missing','empty','loading','error','long','industry','mixed']);
 for(const view of views)for(const width of [1280,390,320])for(const state of (view==='weekly'&&!requestedStates&&!process.argv.includes('--smoke')?[...states,'bye']:view==='live'&&!requestedStates&&!process.argv.includes('--smoke')?[...states,'complete']:view==='preseason'&&!requestedStates&&!process.argv.includes('--smoke')?[...states,'seasonTotals']:states)) {
  if(width===1280&&state==='ready'){await browser.close();browser=await chromium.launch({headless:true});}
  const page=await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'});const errors=[];
  page.on('pageerror',e=>{errors.push(e.message);console.error('PAGE ERROR',e.message)});
  await page.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
  await page.goto(`${base}/projections/${view==='weekly'?'weekly':`season/${view==='preseason'?'preseason':'live'}`}?state=${state}&theme=${width===1280?'dark':'light'}`,{waitUntil:'networkidle'});
  if(['ready','large','missing','long','complete','industry','mixed','seasonTotals','bye'].includes(state))await page.locator('.projection-tier-player').first().waitFor({timeout:10000}).catch(async e=>{console.error((await page.locator('body').innerText()).slice(0,2000));throw e;});
  if(state==='loading')await page.locator('.hub-loading-skeleton').first().waitFor();
  const audit=await page.evaluate(measureScript(),{minTarget:width<769?44:32,numericRe:NUMERIC_RE.source,barControlSelector:BAR_CONTROL_SELECTOR,tableDeadZonePx:TABLE_DEAD_ZONE_PX,columnPackRatio:COLUMN_PACK_RATIO,gutterSelectors:GUTTER_EDGE_SELECTORS});
  const report={view,width,state,errors,failures:audit.filter(r=>!r.ok)};reports.push(report);await fs.writeFile(`${out}/audit.json`,JSON.stringify(reports,null,2));console.log(JSON.stringify(report));
  await page.screenshot({path:`${out}/${view}-${state}-${width}.png`,fullPage:state!=='long'});
  if(['ready','large','missing','long','industry','mixed','seasonTotals','bye'].includes(state)){
   const bounds=await page.locator('.projection-tier-primary').evaluateAll(es=>es.map(e=>({width:e.clientWidth,scroll:e.scrollWidth,right:e.getBoundingClientRect().right,viewport:innerWidth})));
   assert.ok(bounds.every(b=>b.scroll<=b.width+1&&b.right<=b.viewport),'All primary figures fit inside their cells and the viewport');
  }
  if(['industry','mixed','seasonTotals'].includes(state)){
   assert.equal(await page.locator('.projection-tier-player').count(),await page.evaluate(()=>window.fixtureRows.length));
   const tiers=await page.evaluate(()=>{
    let current=null;const result={};
    document.querySelectorAll('[data-tier],.projection-tier-player').forEach(e=>{
     if(e.dataset.tier)current=e.dataset.tier;
     else result[e.dataset.playerId]=current;
    });return result;
   });
   if(state==='industry'){assert.equal(tiers.p0,'S');assert.equal(tiers.p1,'S');assert.equal(tiers.p3,'F');assert.equal(tiers.p4,'unknown');}
   if(state==='mixed'){assert.equal(tiers.p0,'S');assert.equal(tiers.p1,'S');assert.equal(tiers.p2,'A');assert.equal(tiers.p4,'F');assert.equal(tiers.p5,'F');assert.equal(tiers.p6,'unknown');assert.equal(tiers.p7,'unknown');}
   if(state==='seasonTotals'){assert.equal(tiers.p0,'F');assert.equal(tiers.p1,'S');assert.match(await page.locator('[data-tier=S]').innerText(),/RB 340\+/);}
  }
  if(state==='bye'){
   assert.equal(await page.locator('.projection-tier-player').count(),3);
   assert.match(await page.locator('[data-tier=bye]').innerText(),/On bye/);
   for(const id of ['p0','p1'])assert.match(await page.locator(`[data-player-id=${id}] .projection-tier-primary`).innerText(),/Bye week/);
   assert.equal((await page.locator('[data-player-id=p0] .projection-tier-rank').innerText()).trim(),'—');
   assert.match(await page.locator('.proj-signals').innerText(),/Active receiver/);
   assert.doesNotMatch(await page.locator('.proj-signals').innerText(),/Amon-Ra|Jefferson/);
   await page.getByRole('button',{name:'Compare',exact:true}).click();
   assert.equal(await page.locator('[data-player-id=p0] .projection-tier-primary').isDisabled(),true);
   await page.getByRole('button',{name:'Open Amon-Ra St. Brown details',exact:true}).click();
   await page.locator('.player-profile-log').waitFor();
   assert.equal(await page.locator('.player-profile-number').innerText(),'Bye');
   assert.equal(await page.locator('.player-profile-range').count(),0);
   assert.equal(await page.locator('.player-inspector-add').count(),0);
   assert.equal(await page.getByText('Projection details',{exact:true}).count(),0);
   await page.getByText('Player notes',{exact:true}).click();
   await page.getByText('No current player notes.',{exact:true}).waitFor();
   assert.doesNotMatch(await page.locator('.player-inspector').innerText(),/healthy slate|Older notes|No usable note/);
   const byeAudit=await page.evaluate(measureScript(),{minTarget:width<769?44:32,numericRe:NUMERIC_RE.source,barControlSelector:BAR_CONTROL_SELECTOR,tableDeadZonePx:TABLE_DEAD_ZONE_PX,columnPackRatio:COLUMN_PACK_RATIO,gutterSelectors:GUTTER_EDGE_SELECTORS});
   reports.push({view,width,state:'bye-card',errors,failures:byeAudit.filter(r=>!r.ok)});
   await page.screenshot({path:`${out}/weekly-bye-card-${width}.png`});
   await page.getByRole('tab',{name:'Rest of season',exact:true}).click();
   assert.match(await page.locator('.player-profile-number').innerText(),/180.0/);
   await page.keyboard.press('Escape');
   await page.getByRole('button',{name:'Done',exact:true}).click();
   if(width===1280){const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Export CSV',exact:true}).click();const dl=await pending;const csv=await fs.readFile(await dl.path(),'utf8');assert.equal((csv.match(/BYE/g)||[]).length,6);}
  }
  if(state==='complete'){
   assert.equal(await page.getByRole('button',{name:'Rest of season',exact:true}).count(),0);
   assert.match(await page.locator('[data-player-id=p0] .projection-tier-primary').innerText(),/138.0/);
  }
  if(state==='ready'){
   const rendered=await page.locator('.projection-tier-player[data-player-id]').evaluateAll(es=>es.map(e=>e.dataset.playerId));
   assert.equal(new Set(rendered).size,await page.evaluate(()=>window.fixtureRows.length));
   const numberBounds=await page.locator('.projection-tier-primary').evaluateAll(es=>es.map(e=>({width:e.clientWidth,scroll:e.scrollWidth,right:e.getBoundingClientRect().right,viewport:innerWidth})));
   assert.ok(numberBounds.every(b=>b.scroll<=b.width+1&&b.right<=b.viewport),'Primary numbers fit and stay inside the viewport');
   await page.getByRole('button',{name:'Open Bijan Robinson details',exact:true}).click();
   await page.locator('.player-profile-log').waitFor();
   const card=await page.locator(width>768?'.player-card-centered':'.player-card-sheet').boundingBox();
   assert.ok(card.x>=0&&card.x+card.width<=width+1,'Player card stays inside the viewport');
   if(width>768){const overlay=await page.locator('.player-card-overlay--center').boundingBox();assert.ok(Math.abs(card.x+card.width/2-overlay.x-overlay.width/2)<2,'Desktop player card stays centered in its overlay');}
   else {const edge=await page.locator('.app-mobile-sheet-overlay').evaluate(e=>e.getBoundingClientRect().bottom-parseFloat(getComputedStyle(e).paddingBottom));assert.ok(Math.abs(card.y+card.height-edge)<2,'Mobile player card stays at the bottom sheet inset');}
   await page.getByText('Player notes',{exact:true}).click();
   await page.getByText('Full practice on Friday.',{exact:true}).waitFor();
   assert.doesNotMatch(await page.locator('.player-inspector').innerText(),/healthy slate|Older notes|No usable note/);
   await page.getByText('Player notes',{exact:true}).click();
   if(view!=='preseason'){
    await page.getByText('Projection details',{exact:true}).click();
    await page.getByText('Recent usage',{exact:true}).waitFor();
    await page.getByText('Elevated uncertainty',{exact:true}).waitFor();
    await page.waitForFunction(()=>document.querySelector('.projection-explanation')?.innerText.includes('typical miss'));
    assert.doesNotMatch(await page.locator('.player-inspector').innerText(),/forecast assumes|weekly artifacts|processed usage features|Narrative context|Context overlay|Why this projection/);
    await page.locator('.projection-explanation').scrollIntoViewIfNeeded();
    const detailAudit=await page.evaluate(measureScript(),{minTarget:width<769?44:32,numericRe:NUMERIC_RE.source,barControlSelector:BAR_CONTROL_SELECTOR,tableDeadZonePx:TABLE_DEAD_ZONE_PX,columnPackRatio:COLUMN_PACK_RATIO,gutterSelectors:GUTTER_EDGE_SELECTORS});
    reports.push({view,width,state:'card-details',errors,failures:detailAudit.filter(r=>!r.ok)});
    await page.screenshot({path:`${out}/${view}-details-${width}.png`});
    await page.getByText('Projection details',{exact:true}).click();
   }
   if(view!=='preseason'){await page.getByRole('tab' ,{name:'Season so far',exact:true}).click();await page.getByRole('tab',{name:'Rest of season',exact:true}).click();}
   await page.screenshot({path:`${out}/${view}-card-${width}.png`});
   await page.keyboard.press('Escape');
   if(view==='weekly') {
    await page.getByRole('button',{name:'Compare',exact:true}).click();
    await page.locator('[data-player-id=p0] .projection-tier-primary').click();
    await page.locator('[data-player-id=p1] .projection-tier-primary').click();
    assert.equal(await page.locator('.projection-tier-player.is-selected').count(),2);
    await page.getByRole('button',{name:'Open Bijan Robinson details',exact:true}).click();
    await page.locator('.player-profile-log').waitFor();await page.keyboard.press('Escape');
    await page.getByRole('region',{name:'Compare selection'}).getByRole('button',{name:'Clear',exact:true}).click();
    await page.getByRole('button',{name:'Done',exact:true}).click();
   }
   if(width===1280){
    const sortButton=page.locator('.projection-tier-table thead th').last().getByRole('button');
    await sortButton.click();
    assert.notEqual(await page.locator('.projection-tier-player').first().getAttribute('data-player-id'),'p0','Sort applies within S tier');
    await sortButton.click();
    assert.equal(await page.locator('.projection-tier-player').first().getAttribute('data-player-id'),'p0');
    const search=page.getByRole('searchbox',{name:view==='preseason'?'Search the board':'Search player or team',exact:true});
    await search.fill('Bijan Robinson');
    await page.waitForFunction(()=>document.querySelectorAll('.projection-tier-player').length===1);
    await search.fill('');
    await page.waitForFunction(()=>document.querySelectorAll('.projection-tier-player').length===window.fixtureRows.length);
   }
   if(view==='live') {
    await page.getByRole('button',{name:'Season so far',exact:true}).click();
    assert.match(await page.locator('[data-player-id=p0] .projection-tier-primary').innerText(),/138.0/);
    assert.equal(await page.locator('.projection-tier-player').count(),await page.evaluate(()=>window.fixtureRows.length));
    const actualAudit=await page.evaluate(measureScript(),{minTarget:width<769?44:32,numericRe:NUMERIC_RE.source,barControlSelector:BAR_CONTROL_SELECTOR,tableDeadZonePx:TABLE_DEAD_ZONE_PX,columnPackRatio:COLUMN_PACK_RATIO,gutterSelectors:GUTTER_EDGE_SELECTORS});
    reports.push({view,width,state:'recorded',errors,failures:actualAudit.filter(r=>!r.ok)});
    await page.screenshot({path:`${out}/live-recorded-${width}.png`,fullPage:true});
    await page.getByRole('button',{name:'Rest of season',exact:true}).click();
   }
  }
  if(state==='long'){
   const total=await page.evaluate(()=>window.fixtureRows.length);
   if(view==='weekly'&&width!==320){
    const visited=await page.evaluate(async()=>{
      const ids=new Set();
      for(let y=0;y<document.body.scrollHeight;y+=600){
        window.scrollTo(0,y);await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
        document.querySelectorAll('.projection-tier-player[data-player-id]').forEach(row=>ids.add(row.dataset.playerId));
      }
      return [...ids];
    });
    assert.equal(visited.length,total,'Every row is reachable while scrolling the full F-tier board');
   }
   assert.ok(await page.locator('.projection-tier-player').count()<total/2,'Long F tier is windowed');
   for(let i=0;i<3;i++){await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));await page.waitForTimeout(80);}
   await page.locator('[data-player-id=tail799]').waitFor();
   assert.match(await page.locator('[data-player-id=tail799]').innerText(),/Last zero-point player/);
   await page.screenshot({path:`${out}/${view}-tail-${width}.png`});
   if(width===1280){
    const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Export CSV',exact:true}).click();
    const download=await pending;const csv=await fs.readFile(await download.path(),'utf8');
    assert.equal(csv.trim().split(/\r?\n/).length,total+1,'CSV retains every F-tier row');
   }
  }
  assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>window.fixtureWrites),[]);
  await page.close();
 }
 await fs.writeFile(`${out}/audit.json`,JSON.stringify(reports,null,2));
 assert.ok(reports.every(r=>!r.failures.length),'Every affected layout passes');
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
