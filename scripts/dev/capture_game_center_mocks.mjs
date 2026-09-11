import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../../frontend/package.json',import.meta.url));
const {chromium}=require('playwright');
import {measureScript,NUMERIC_RE,BAR_CONTROL_SELECTOR,TABLE_DEAD_ZONE_PX,COLUMN_PACK_RATIO,GUTTER_EDGE_SELECTORS} from './layout_audit.mjs';
const browser=await chromium.launch({headless:true,channel:'msedge'});await fs.mkdir('outputs/game-center',{recursive:true});const report=[];
for(const width of [1280,390])for(const option of ['a','b']){
 const page=await browser.newPage({viewport:{width,height:1000}});await page.goto(`http://127.0.0.1:5177/docs/mockups/game-center-room-${option}.html`,{waitUntil:'load'});
 const results=await page.evaluate(measureScript(),{minTarget:width===390?44:32,numericRe:NUMERIC_RE.source,barControlSelector:BAR_CONTROL_SELECTOR,tableDeadZonePx:TABLE_DEAD_ZONE_PX,columnPackRatio:COLUMN_PACK_RATIO,gutterSelectors:GUTTER_EDGE_SELECTORS});
 await page.screenshot({path:`outputs/game-center/${option}-${width}.png`,fullPage:true});report.push({option,width,results});console.log(option,width,results.filter(r=>!r.ok));await page.close();
}await fs.writeFile('outputs/game-center/audit.json',JSON.stringify(report,null,2));await browser.close();

if(report.some(r=>r.results.some(x=>!x.ok))) process.exitCode=1;
