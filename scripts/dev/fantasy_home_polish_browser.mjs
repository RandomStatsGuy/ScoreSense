import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {attachHomeFixture} from './fantasy_home_fixture.mjs';
import {auditHighlightInsets,measureScript,NUMERIC_RE,BAR_CONTROL_SELECTOR,TABLE_DEAD_ZONE_PX,COLUMN_PACK_RATIO,GUTTER_EDGE_SELECTORS} from './layout_audit.mjs';
const require=createRequire(new URL('../../frontend/package.json',import.meta.url));
const {chromium}=require('playwright');
const browser=await chromium.launch({headless:true});
const out='outputs/fantasy-home-pr',reports=[];
await fs.mkdir(out,{recursive:true});
try{
 for(const width of [1280,390,320])for(const scenario of ['snow','long','no-art','light']){
  const page=await browser.newPage({viewport:{width,height:width===1280?1000:844}});
  await attachHomeFixture(page);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const query=new URLSearchParams({state:'live',palette:'snow',...(scenario==='long'?{long:'1'}:{}),...(scenario==='no-art'?{art:'none'}:{}),...(scenario==='light'?{theme:'light'}:{})});
  await page.goto(`http://127.0.0.1:5173/test-fixtures/fantasy-home.html?${query}`);
  await page.locator('.hub-home-matchup-value').first().waitFor();
  await page.locator('.chat-loading').waitFor({state:'hidden'});
  if(scenario!=='no-art'){
   await page.waitForFunction(()=>document.querySelectorAll('.hub-home-matchup-art img').length===2&&[...document.querySelectorAll('.hub-home-matchup-art img')].every(img=>img.complete&&img.naturalWidth>0));
   assert.equal(await page.locator('.hub-home-matchup-art img').first().evaluate(e=>e.style.getPropertyValue('--crop-x')),'35%');
  }else assert.equal(await page.locator('.hub-home-matchup-art img').count(),0);
  const insets=await auditHighlightInsets(page);
  const layout=await page.evaluate(measureScript(),{minTarget:width<769?44:32,numericRe:NUMERIC_RE.source,barControlSelector:BAR_CONTROL_SELECTOR,tableDeadZonePx:TABLE_DEAD_ZONE_PX,columnPackRatio:COLUMN_PACK_RATIO,gutterSelectors:GUTTER_EDGE_SELECTORS});
  const edge=await page.locator('.hub-home-standings-table .is-you').evaluate(row=>({left:getComputedStyle(row.cells[0]).paddingLeft,right:getComputedStyle(row.cells[row.cells.length-1]).paddingRight}));
  assert.deepEqual(edge,{left:'12px',right:'12px'});
  assert.deepEqual(errors,[]);
  reports.push({width,scenario,insets,layout});
  if(width!==320){
   await page.screenshot({path:`${out}/polish-${scenario}-${width}.png`,fullPage:true});
   if(scenario==='snow')await page.locator('.hub-home-standings-table').screenshot({path:`${out}/standings-insets-${width}.png`});
  }
  await page.close();
 }
}finally{await browser.close();await fs.writeFile(`${out}/polish-review.json`,JSON.stringify(reports,null,2));}
const failures=reports.flatMap(row=>[...row.insets,...row.layout].filter(x=>!x.ok).map(x=>({width:row.width,scenario:row.scenario,...x})));
console.log(JSON.stringify({reviews:reports.length,failures},null,2));
assert.deepEqual(failures,[]);
