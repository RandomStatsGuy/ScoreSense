/** Responsive regression for the production This Week matchup summary. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import {measureScript,NUMERIC_RE,BAR_CONTROL_SELECTOR,TABLE_DEAD_ZONE_PX,COLUMN_PACK_RATIO,GUTTER_EDGE_SELECTORS} from './layout_audit.mjs';
const require=createRequire(new URL('../../frontend/package.json',import.meta.url));
const {chromium}=require('playwright');
const out='outputs/week-forecast-fix';
await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});
const report=[];
try {
  for(const width of [320,390,1280,1720]) {
    const page=await browser.newPage({viewport:{width,height:900}});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.route('https://**/*',route=>route.abort());
    for(const state of ['ready','specialists','missing','live','final']) {
      await page.goto(`http://127.0.0.1:5173/test-fixtures/weekly-experience.html?state=${state}&member=1&long-opponent=1`);
      await page.locator('.hub-week-forecast > strong').waitFor();
      await page.getByRole('heading',{name:'Your starters',exact:true}).waitFor();
      const results=await page.evaluate(measureScript(),{minTarget:width<=768?44:32,numericRe:NUMERIC_RE.source,barControlSelector:BAR_CONTROL_SELECTOR,tableDeadZonePx:TABLE_DEAD_ZONE_PX,columnPackRatio:COLUMN_PACK_RATIO,gutterSelectors:GUTTER_EDGE_SELECTORS});
      assert.deepEqual(results.filter(result=>!result.ok),[],JSON.stringify({width,state,results}));
      const box=await page.locator('.hub-week-forecast').boundingBox();
      assert.ok(box.height<=80,`Summary grew to ${box.height}px at ${width}`);
      assert.doesNotMatch(await page.locator('.hub-week-forecast').innerText(),/K\/DEF|season estimates/);
      if(state==='specialists') {
        assert.match(await page.locator('.hub-week-forecast > strong').innerText(),/84.4\s+—\s+71.0/);
        await page.screenshot({path:`${out}/summary-${width}.png`});
      }
      if(state==='missing')assert.match(await page.locator('.hub-week-forecast > strong').innerText(),/^—\s+—\s+71.0/);
      assert.deepEqual(errors,[]);
      report.push({width,state,height:box.height,results});
    }
    await page.close();
    console.log(`PASS ${width}: projected, K/DEF, missing, live, final; long opponent name`);
  }
} finally {
  await fs.writeFile(`${out}/audit.json`,JSON.stringify(report,null,2));
  await browser.close();
}
