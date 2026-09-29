import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import {measureScript,NUMERIC_RE,BAR_CONTROL_SELECTOR,TABLE_DEAD_ZONE_PX,COLUMN_PACK_RATIO,GUTTER_EDGE_SELECTORS} from './layout_audit.mjs';
const require=createRequire(new URL('../../frontend/package.json',import.meta.url));
const {chromium}=require('playwright');
const browser=await chromium.launch({headless:true});
const report=[];
try {
 for(const width of [390,1280]){
  const page=await browser.newPage({viewport:{width,height:900}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  for(const route of ['/hub/roster','/hub/home','/hub/week','/hub/game','/hub/cap','/hub/rules']){
   await page.goto('http://127.0.0.1:5173'+route,{waitUntil:'networkidle'});
   await page.locator('main#main-content').waitFor();
   if(route==='/hub/roster'){
    await page.getByRole('button',{name:'Manage roster',exact:true}).click();
    await page.locator('.my-team-overview').waitFor();
   }
   const results=await page.evaluate(measureScript(),{minTarget:width<=768?44:32,numericRe:NUMERIC_RE.source,barControlSelector:BAR_CONTROL_SELECTOR,tableDeadZonePx:TABLE_DEAD_ZONE_PX,columnPackRatio:COLUMN_PACK_RATIO,gutterSelectors:GUTTER_EDGE_SELECTORS});
   report.push({width,route,results});
   assert.deepEqual(results.filter(r=>['phone-chrome','team-summary'].includes(r.rule)&&!r.ok),[]);
   if(route==='/hub/roster')await page.screenshot({path:`outputs/my-team-review/live-${width}.png`,fullPage:true});
   console.log(JSON.stringify({width,route,failures:results.filter(r=>!r.ok)}));
  }
  assert.deepEqual(errors,[]);
  await page.close();
 }
}finally{
 await fs.writeFile('outputs/my-team-review/live-audit.json',JSON.stringify(report,null,2));
 await browser.close();
}
