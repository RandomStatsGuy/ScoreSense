// Real Trades and DFS components: cache recovery, saved forecasts, and failure.
import { chromium } from '../../frontend/node_modules/playwright/index.mjs';
import { build } from '../../frontend/node_modules/esbuild/lib/main.js';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { measureScript, NUMERIC_RE, BAR_CONTROL_SELECTOR, TABLE_DEAD_ZONE_PX, COLUMN_PACK_RATIO, GUTTER_EDGE_SELECTORS } from './layout_audit.mjs';

fs.mkdirSync('outputs/projection-recovery',{recursive:true});
await build({entryPoints:['frontend/test-fixtures/trades-transfers.jsx'],bundle:true,jsx:'automatic',
 format:'esm',outfile:'outputs/projection-recovery/trades.js',external:['/art/*'],
 loader:{'.js':'jsx','.png':'dataurl','.svg':'dataurl','.webp':'dataurl','.woff2':'dataurl'},
 define:{'process.env.NODE_ENV':'"production"'}});
await build({entryPoints:['frontend/test-fixtures/dfs-workspace.jsx'],bundle:true,jsx:'automatic',
 format:'esm',outfile:'outputs/projection-recovery/dfs.js',external:['/art/*'],
 loader:{'.js':'jsx','.png':'dataurl','.svg':'dataurl','.webp':'dataurl','.woff2':'dataurl'},
 define:{'process.env.NODE_ENV':'"production"'}});
const browser=await chromium.launch({headless:true,channel:'msedge'});
const results=[];
try {
 for(const width of [1280,390]) {
  const page=await browser.newPage({viewport:{width,height:900}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/theme-init.js',r=>r.fulfill({contentType:'text/javascript',body:fs.readFileSync('frontend/public/theme-init.js','utf8')}));
  await page.route('**/__projection_qa/**',async r=>{
   const path=new URL(r.request().url()).pathname;
   const entry=path.includes('dfs')?'dfs':'trades';
   const file=path.endsWith('.js')?`${entry}.js`:path.endsWith('.css')?`${entry}.css`:null;
   await r.fulfill({contentType:file?.endsWith('.js')?'text/javascript':file?'text/css':'text/html',
    body:file?fs.readFileSync('outputs/projection-recovery/'+file):`<html><head><script src="/theme-init.js"></script><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="${entry}.css"></head><body><div id="root"></div><script type="module" src="${entry}.js"></script></body></html>`});
  });
  await page.goto('http://127.0.0.1:5173/__projection_qa/index.html?state=salary');
  await page.locator('.ss-trade-rank-strong').first().waitFor();
  const options={minTarget:width===390?44:32,numericRe:NUMERIC_RE.source,
    barControlSelector:BAR_CONTROL_SELECTOR,tableDeadZonePx:TABLE_DEAD_ZONE_PX,columnPackRatio:COLUMN_PACK_RATIO,
    gutterSelectors:GUTTER_EDGE_SELECTORS};
  const baselineFailures=(await page.evaluate(measureScript(),options)).filter(x=>!x.ok);
  for(const state of ['recovering','saved','forecast-error','missing']) {
   await page.goto(`http://127.0.0.1:5173/__projection_qa/index.html?state=${state}`);
   const status=page.locator('.ss-trade-discovery [role="status"]');
   await status.waitFor();
   if(state==='recovering'){
    assert.match(await status.textContent(),/Updating forecasts/);
    await page.locator('.ss-trade-rank-strong').first().waitFor({timeout:15000});
    assert.ok(await page.evaluate(()=>window.forecastReads>=2));
    assert.equal(await status.count(),0);
   } else {
    assert.match(await status.textContent(),state==='saved'?/saved forecasts/:state==='missing'?/1 player still needs/:/failed/);
   }
   const checks=await page.evaluate(measureScript(),{minTarget:width===390?44:32,numericRe:NUMERIC_RE.source,
    barControlSelector:BAR_CONTROL_SELECTOR,tableDeadZonePx:TABLE_DEAD_ZONE_PX,columnPackRatio:COLUMN_PACK_RATIO,
    gutterSelectors:GUTTER_EDGE_SELECTORS});
   assert.deepEqual(checks.filter(x=>!x.ok),baselineFailures, 'No new layout failures versus the unchanged page');
   await page.screenshot({path:`outputs/projection-recovery/${state}-${width}.png`,fullPage:true});
   results.push({surface:'Trades',width,state,behavior:'PASS',layout:baselineFailures.length?'FAIL (existing header)':'PASS',baselineFailures});
  }
  await page.goto('http://127.0.0.1:5173/__projection_qa/dfs.html');
  await page.locator('.dfw-freshness.is-good').waitFor();
  const dfsBaseline=(await page.evaluate(measureScript(),options)).filter(x=>!x.ok);
  for(const state of ['recovering','saved','forecast-error']) {
   await page.goto(`http://127.0.0.1:5173/__projection_qa/dfs.html?state=${state}`);
   const status=page.locator('.dfw-freshness');
   await status.waitFor();
   if(state==='recovering') {
    await status.getByText('Updating projections',{exact:true}).waitFor();
    await page.locator('.dfw-freshness.is-good').waitFor({timeout:15000});
    assert.ok(await page.evaluate(()=>window.__dfsPoolReads>=2));
    assert.ok(await page.locator('.dfw-player-table tbody tr').count()>0);
   } else {
    await page.waitForFunction(() => !document.querySelector('.dfw-freshness')?.textContent.includes('Loading'));
    assert.match(await status.textContent(),state==='saved'?/saved forecasts/:/could not load/i);
   }
   const failures=(await page.evaluate(measureScript(),options)).filter(x=>!x.ok);
   assert.deepEqual(failures,dfsBaseline,'No new DFS layout failures');
   await page.screenshot({path:`outputs/projection-recovery/dfs-${state}-${width}.png`,fullPage:true});
   results.push({surface:'DFS',width,state,behavior:'PASS',layout:dfsBaseline.length?'FAIL (existing layout)':'PASS',baselineFailures:dfsBaseline});
  }
  assert.deepEqual(errors,[]);await page.close();
 }
} finally {await browser.close();}
fs.writeFileSync('outputs/projection-recovery/audit.json',JSON.stringify(results,null,2));
console.log(JSON.stringify(results));
