import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs/promises';
import {measureScript,NUMERIC_RE,BAR_CONTROL_SELECTOR,TABLE_DEAD_ZONE_PX,COLUMN_PACK_RATIO,GUTTER_EDGE_SELECTORS} from './layout_audit.mjs';
const require=createRequire(new URL('../../frontend/package.json',import.meta.url));
const {chromium}=require('playwright'),{build}=require('esbuild');
const bundle=await build({entryPoints:[fileURLToPath(new URL('../../frontend/test-fixtures/week-overview.jsx',import.meta.url))],bundle:true,jsx:'automatic',format:'esm',write:false,outdir:'outputs/week-overview-assets',external:['/art/*','/fonts/*'],define:{'process.env.NODE_ENV':'"production"','import.meta.env':'{"DEV":true,"PROD":false}'},loader:{'.woff2':'dataurl','.woff':'dataurl','.png':'dataurl','.svg':'dataurl'}});
const js=bundle.outputFiles.find(f=>f.path.endsWith('.js')).contents,css=bundle.outputFiles.find(f=>f.path.endsWith('.css')).contents;
const init=await fs.readFile(new URL('../../frontend/public/theme-init.js',import.meta.url),'utf8');
const html='<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>This Week review</title><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script>'+init+'</script><script type="module" src="/fixture.js"></script></body></html>';
const exportDir=process.argv.find(arg=>arg.startsWith('--export='))?.slice(9);
if(exportDir) {
 await fs.mkdir(exportDir,{recursive:true});
 await Promise.all([fs.writeFile(`${exportDir}/index.html`,html.replaceAll('/fixture.', './fixture.')),fs.writeFile(`${exportDir}/fixture.js`,js),fs.writeFile(`${exportDir}/fixture.css`,css)]);
 if(process.argv.includes('--export-only'))process.exit(0);
}
const server=createServer((req,res)=>{const path=new URL(req.url,'http://localhost').pathname;res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html');res.end(path==='/fixture.js'?js:path==='/fixture.css'?css:html);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`,out='outputs/week-overview-review';
await fs.mkdir(out,{recursive:true});
let browser;const reports=[];
try {
 browser=await chromium.launch({headless:true});
 for(const width of (process.argv.includes("--detail-only")?[]:[1280,390,320]))for(const state of ['ready','live','final','missing','score-error','loading','no-roster','noart','long']) {
  const page=await browser.newPage({viewport:{width,height:1000},serviceWorkers:'block',reducedMotion:'reduce'});
  const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error('PAGE ERROR',e.message)});
  await page.goto(`${base}/test-fixtures/week-overview.html?state=${state}&${state==='noart'?'noart=1':''}&${state==='long'?'long=1&long-opponent=1':''}&theme=${state==='live'?'dark':'light'}`,{waitUntil:'networkidle'});
  await page.locator('.week-overview').waitFor();
  if(!['score-error','loading','no-roster'].includes(state))await page.locator('.week-overview-feature').waitFor();
  if(state==='loading')await page.locator('.week-overview .hub-loading-skeleton').waitFor();
  if(state==='score-error')await page.getByText('Try again',{exact:true}).waitFor();
  if(!['score-error','loading','no-roster'].includes(state)) {
   assert.equal(await page.locator('.week-overview-games>li').count(),2);
   assert.equal(await page.locator('.hub-wcc-position-button').count(),0);
   if(state==='missing')assert.equal(await page.locator('.week-overview-feature .week-overview-score>strong').first().innerText(),'—');
   if(state==='noart')assert.equal(await page.locator('.week-overview-feature .matchup-banner-art img').count(),0);
   else await page.waitForFunction(()=>{const images=[...document.querySelectorAll('.week-overview-feature .matchup-banner-art img')];return images.length===2&&images.every(img=>img.complete&&img.naturalWidth>0)});
   const tops=await page.locator('.week-overview-feature .week-overview-score').evaluateAll(es=>es.map(e=>e.getBoundingClientRect().top));
   assert.ok(Math.abs(tops[0]-tops[1])<2,'Featured scores share a baseline even with long identities');
   await page.locator('.week-overview-standings summary').click();
   await page.locator('.week-overview-standings summary').press('Enter');
   await page.locator('.week-overview-heading h1').click();
  }
  const audit=await page.evaluate(measureScript(),{minTarget:width<769?44:32,numericRe:NUMERIC_RE.source,barControlSelector:BAR_CONTROL_SELECTOR,tableDeadZonePx:TABLE_DEAD_ZONE_PX,columnPackRatio:COLUMN_PACK_RATIO,gutterSelectors:GUTTER_EDGE_SELECTORS});
  const failures=audit.filter(r=>!r.ok);reports.push({width,state,failures,errors});console.log(JSON.stringify(reports.at(-1)));
  await page.screenshot({path:`${out}/${state}-${width}.png`,fullPage:true});
  assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>window.fixtureWrites),[]);
  await page.close();
 }
 // Exercise actual My team integration. Only fixture memory receives the write.
 for(const width of (process.argv.includes("--detail-only")?[]:[1280,390])) {
  const page=await browser.newPage({viewport:{width,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${base}/hub/roster?lineup=1&state=ready&theme=light`,{waitUntil:'networkidle'});
  await page.getByRole('group',{name:'My team view',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Lineup',exact:true}).getAttribute('aria-pressed'),'true');
  const slot=page.locator('.hub-wcc-position-button').filter({hasText:'FLEX'}).first();await slot.click();
  await page.getByRole('radio',{name:'DeVonta Smith',exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>window.fixtureWrites),[]);
  await page.getByRole('button',{name:/Confirm|Save|Start DeVonta/}).click();
  await page.waitForFunction(()=>window.fixtureWrites.length===1);
  assert.equal((await page.evaluate(()=>window.fixtureWrites))[0].body.bench_player_id,'smith');
  await page.locator('.lineup-picker-backdrop').waitFor({state:'hidden'});
  await page.locator('.hub-wcc-position-button').filter({hasText:'FLEX'}).waitFor();
  await page.screenshot({path:`${out}/my-team-lineup-${width}.png`,fullPage:true});
  const audit=await page.evaluate(measureScript(),{minTarget:width<769?44:32,numericRe:NUMERIC_RE.source,barControlSelector:BAR_CONTROL_SELECTOR,tableDeadZonePx:TABLE_DEAD_ZONE_PX,columnPackRatio:COLUMN_PACK_RATIO,gutterSelectors:GUTTER_EDGE_SELECTORS});
  reports.push({width,state:'my-team-saved',failures:audit.filter(r=>!r.ok),errors});
  assert.deepEqual(errors,[]);await page.close();
 }
 for(const width of [1280,390]) {
  const page=await browser.newPage({viewport:{width,height:1000}});const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`${base}/hub/game?matchupTeam=third&week=2&state=ready`,{waitUntil:'networkidle'});
  await page.locator('.gc-room-scoreboard').waitFor();
  await page.getByRole('button',{name:'Review lineup',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.fixtureDestination),'roster');
  assert.deepEqual(await page.evaluate(()=>window.fixtureNavigationExtra),{lineup:true,week:2});
  assert.deepEqual(await page.evaluate(()=>window.fixtureWrites),[]);
  await page.goto(`${base}/hub/roster?lineup=1&state=linked`,{waitUntil:'networkidle'});
  await page.locator('.hub-wcc-position-button').filter({hasText:'FLEX'}).first().click();
  await page.locator('.lineup-picker').getByRole('link',{name:/Sleeper/}).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.fixtureWrites),[]);
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.locator('.lineup-picker-backdrop').waitFor({state:'hidden'});
  assert.deepEqual(errors,[]);await page.close();
 }
 await fs.writeFile(`${out}/checks.json`,JSON.stringify(reports,null,2));
 assert.ok(reports.every(r=>!r.failures.length),'Every overview layout check passes');
} finally {await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
