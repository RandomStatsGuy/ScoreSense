import fs from 'node:fs';
import {chromium} from '../../frontend/node_modules/playwright/index.mjs';
import {measureScript,NUMERIC_RE,BAR_CONTROL_SELECTOR,TABLE_DEAD_ZONE_PX,COLUMN_PACK_RATIO,GUTTER_EDGE_SELECTORS,minTargetForWidth} from './layout_audit.mjs';
const browser=await chromium.launch({headless:true}); const report=[];
for(const width of [1280,390]) {
 const page=await browser.newPage({viewport:{width,height:width===390?844:900}});
 for(const [name,route] of [['rules','/hub/rules'],['salary','/hub/roster-management/sheets'],['access','/hub/roster-management/access'],['insights','/hub/insights/overview']]) {
 await page.goto('http://127.0.0.1:5173'+route); await page.waitForTimeout(1300);
 await page.screenshot({path:`docs/reviews/hub-guided-focus/live-${name}-${width}.png`,fullPage:true});
 const results=await page.evaluate(measureScript(),{minTarget:minTargetForWidth(width),numericRe:NUMERIC_RE.source,barControlSelector:BAR_CONTROL_SELECTOR,tableDeadZonePx:TABLE_DEAD_ZONE_PX,columnPackRatio:COLUMN_PACK_RATIO,gutterSelectors:GUTTER_EDGE_SELECTORS});
 const primary=await page.locator('.btn-primary:visible').allTextContents();
 report.push({route,width,results,primary}); console.log(route,width,JSON.stringify(results.filter(r=>!r.ok)),primary);
 } await page.close();
}
fs.writeFileSync('docs/reviews/hub-guided-focus/live-layout-report.json',JSON.stringify(report,null,2)); await browser.close();
