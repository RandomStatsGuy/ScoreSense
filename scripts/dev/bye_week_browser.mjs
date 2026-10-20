import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import {measureScript,NUMERIC_RE,BAR_CONTROL_SELECTOR,TABLE_DEAD_ZONE_PX,COLUMN_PACK_RATIO,GUTTER_EDGE_SELECTORS} from './layout_audit.mjs';
const require=createRequire(new URL('../../frontend/package.json',import.meta.url));
const {chromium}=require('playwright');
const base=process.env.BYE_WEEK_QA_URL || 'http://127.0.0.1:5173/test-fixtures/lineup-picker.html';
const out='docs/reviews/bye-week-projections';
await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL || (process.platform==='win32'?'msedge':undefined)});
const report=[];
try {
 for(const width of [1280,390]) for(const theme of ['dark','light']) {
  const page=await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'});
  await page.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin?r.continue():r.abort());
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'?state=bye',{waitUntil:'networkidle'});
  await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
  if(width <= 768) await page.locator('.hub-wcc-bench > summary').click();
  for(const name of ['DJ Moore','Trevor Lawrence']) {
   const row=page.locator('.hub-wcc-row',{hasText:name});
   await row.waitFor();
   assert.equal((await row.locator('.hub-wcc-row-pts').innerText()).trim(),'BYE');
   assert.equal(await row.locator('.hub-wcc-range-mark').count(),0);
  }
  assert.equal((await page.locator('.hub-wcc-row',{hasText:'Jalen Hurts'}).locator('.hub-wcc-row-pts').innerText()).trim(),'22.4');
  assert.equal((await page.locator('.hub-wcc-row',{hasText:'Real Zero'}).locator('.hub-wcc-row-pts').innerText()).trim(),'0.0');
  assert.match(await page.locator('.hub-wcc-row',{hasText:'Missing Forecast'}).locator('.hub-wcc-row-pts').innerText(),/—|No projection/);
  assert.deepEqual(await page.evaluate(()=>window.fixtureWrites),[]);
  assert.deepEqual(errors,[]);
  const results=await page.evaluate(measureScript(),{minTarget:width<=768?44:32,numericRe:NUMERIC_RE.source,barControlSelector:BAR_CONTROL_SELECTOR,tableDeadZonePx:TABLE_DEAD_ZONE_PX,columnPackRatio:COLUMN_PACK_RATIO,gutterSelectors:GUTTER_EDGE_SELECTORS});
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
  report.push({width,theme,overflow,results});
  await page.screenshot({path:`${out}/lineup-${theme}-${width}.png`,fullPage:true});
  await page.close();
 }
}finally{await browser.close();await fs.writeFile(`${out}/audit.json`,JSON.stringify(report,null,2));}
assert.deepEqual(report.flatMap(r=>r.results.filter(c=>!c.ok)),[]);
assert.ok(report.every(r=>!r.overflow));
console.log('PASS: confirmed bye forecast, stale score fallback, missing and real-zero controls, no writes; dark/light at 1280/390.');
