import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {measureScript,minTargetForWidth,NUMERIC_RE,BAR_CONTROL_SELECTOR,TABLE_DEAD_ZONE_PX,COLUMN_PACK_RATIO,GUTTER_EDGE_SELECTORS} from './layout_audit.mjs';
const browser = await chromium.launch({headless:true, ...(process.platform === 'win32' ? {channel:'msedge'} : {})});
await fs.mkdir('outputs/dfs-gpp-review',{recursive:true});
for (const option of (process.argv.length > 2 ? process.argv.slice(2) : ['a','b','results'])) {
  for (const width of [1280,390]) {
    const page = await browser.newPage({viewport:{width,height:1000},deviceScaleFactor:1});
    await page.route('**/*', route => new URL(route.request().url()).protocol === 'file:' ? route.continue() : route.abort());
    await page.goto(pathToFileURL(path.resolve(`docs/mockups/dfs-gpp-${option}.html`)).href, {waitUntil:'domcontentloaded'});
    await page.screenshot({path:`outputs/dfs-gpp-review/${option}-${width}.png`,fullPage:true});
    const audit = await page.evaluate(measureScript(), {minTarget:minTargetForWidth(width),numericRe:NUMERIC_RE.source,barControlSelector:BAR_CONTROL_SELECTOR,tableDeadZonePx:TABLE_DEAD_ZONE_PX,columnPackRatio:COLUMN_PACK_RATIO,gutterSelectors:GUTTER_EDGE_SELECTORS});
    await fs.writeFile(`outputs/dfs-gpp-review/${option}-${width}-audit.json`,JSON.stringify(audit,null,2));
    console.log('audit',option,width,audit.filter(r=>!r.ok));
    if (audit.some(r=>!r.ok)) process.exitCode = 1;
    console.log(option,width,await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth})));
    await page.close();
  }
}
await browser.close();
