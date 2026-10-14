import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {measureScript,NUMERIC_RE,BAR_CONTROL_SELECTOR,TABLE_DEAD_ZONE_PX,COLUMN_PACK_RATIO,GUTTER_EDGE_SELECTORS} from './layout_audit.mjs';
const require=createRequire(new URL('../../frontend/package.json',import.meta.url));
const {chromium}=require('playwright');
const mockRoot=fileURLToPath(new URL('../../docs/mockups/',import.meta.url));
let server;
if(!process.env.LAYOUT_AUDIT_BASE){
  server=createServer(async(req,res)=>{
    const target=path.resolve(mockRoot,`.${decodeURIComponent(new URL(req.url,'http://localhost').pathname)}`);
    if(!target.startsWith(mockRoot)){res.writeHead(403);res.end();return;}
    try{
      const content=await fs.readFile(target),types={'.html':'text/html','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml'};
      res.writeHead(200,{'Content-Type':types[path.extname(target)]||'application/octet-stream'});res.end(content);
    }catch{res.writeHead(404);res.end();}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
}
const base=process.env.LAYOUT_AUDIT_BASE||`http://127.0.0.1:${server.address().port}`;
const out='outputs/tier-banner-review';await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true}),reports=[];
try {
  for(const option of ['options','a','b','c'])for(const width of [1280,390,320])for(const theme of ['dark','light']){
    const page=await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    const response=await page.goto(`${base}/tier-banner-${option}.html?theme=${theme}`,{waitUntil:'networkidle'});
    assert.equal(response.status(),200);
    await page.getByRole('radio',{name:'TE',exact:true}).click();
    assert.equal(await page.getByRole('radio',{name:'TE',exact:true}).getAttribute('aria-checked'),'true');
    assert.equal(await page.locator('.tier-range').first().innerText(),'9–11\npts');
    assert.equal(await page.locator('.tier-range').first().getAttribute('title'),'9 to under 11 pts');
    assert.ok(await page.locator('.tier-range-number').first().evaluate(e=>Number(getComputedStyle(e).fontWeight)>=600));
    await page.getByRole('radio',{name:'WR',exact:true}).click();
    await page.mouse.move(0,0);
    const audit=await page.evaluate(measureScript(),{minTarget:width<769?44:32,numericRe:NUMERIC_RE.source,barControlSelector:BAR_CONTROL_SELECTOR,tableDeadZonePx:TABLE_DEAD_ZONE_PX,columnPackRatio:COLUMN_PACK_RATIO,gutterSelectors:GUTTER_EDGE_SELECTORS});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    reports.push({option,width,theme,errors,failures:audit.filter(r=>!r.ok)});
    await page.screenshot({path:`${out}/${option}-${theme}-${width}.png`,fullPage:true});
    if(width===390&&theme==='dark'&&option!=='options')await page.locator('.tier-section').first().screenshot({path:`${out}/${option}-phone-banner.png`});
    if(option==='options'){
      await page.getByRole('link',{name:'B',exact:true}).click();
      assert.ok(new URL(page.url()).pathname.endsWith('tier-banner-b.html'));
    }
    assert.deepEqual(errors,[]);
    await page.close();
  }
}finally{await browser.close();if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await fs.writeFile(`${out}/audit.json`,JSON.stringify(reports,null,2));}
console.log(JSON.stringify({measurements:reports.length,failures:reports.filter(r=>r.errors.length||r.failures.length)}));
assert.ok(reports.every(r=>!r.errors.length&&!r.failures.length),'All banner options pass the shared layout audit');
