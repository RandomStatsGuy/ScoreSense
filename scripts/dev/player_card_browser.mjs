import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {measureScript, NUMERIC_RE, BAR_CONTROL_SELECTOR, TABLE_DEAD_ZONE_PX, COLUMN_PACK_RATIO, GUTTER_EDGE_SELECTORS} from './layout_audit.mjs';
const require=createRequire(new URL('../../frontend/package.json',import.meta.url));
const {chromium}=require('playwright');
const output='outputs/player-card-review';
await mkdir(output,{recursive:true});
const {build}=require('esbuild');
const bundle=await build({entryPoints:[fileURLToPath(new URL('../../frontend/test-fixtures/player-card.jsx',import.meta.url))],bundle:true,jsx:'automatic',format:'esm',write:false,external:['/art/*'],outdir:'outputs/player-card-assets',
 define:{'process.env.NODE_ENV':'"production"','import.meta.env':'{"DEV":true,"PROD":false}'},loader:{'.png':'dataurl','.svg':'dataurl','.woff2':'dataurl'}});
const javascript=bundle.outputFiles.find(file=>file.path.endsWith('.js')).contents;
const stylesheet=bundle.outputFiles.find(file=>file.path.endsWith('.css')).contents;
const server=createServer((request,response)=>{
 const path=new URL(request.url,'http://localhost').pathname;
 response.setHeader('Cache-Control','no-store');
 if(path==='/player-card.js'){response.setHeader('Content-Type','text/javascript');response.end(javascript);}
 else if(path==='/player-card.css'){response.setHeader('Content-Type','text/css');response.end(stylesheet);}
 else {response.setHeader('Content-Type','text/html');response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/player-card.css"></head><body><div id="root"></div><script type="module" src="/player-card.js"></script></body></html>');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
let browser;
const reports=[];
try{
 browser=await chromium.launch({headless:true});
 for(const width of [1280,390])for(const scenario of ['ready','questionable','preseason','missing','error','loading','no-baseline','behind','rb','wr','light']){
  const position=['rb','wr'].includes(scenario)?scenario:'qb';
  const state=['rb','wr','light'].includes(scenario)?'ready':scenario;
  const page=await browser.newPage({viewport:{width,height:1000},serviceWorkers:'block',reducedMotion:'reduce'});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${base}/test-fixtures/player-card.html?state=${state}&position=${position}&theme=${scenario==='light'?'light':'dark'}`,{waitUntil:'networkidle'});
  const open=page.getByRole('button',{name:'Open Josh Allen',exact:true});
  await open.click();
  await page.getByRole('dialog',{name:'Josh Allen',exact:true}).waitFor();
  if(!['loading','error'].includes(state))await page.locator('.player-profile-log').waitFor();
  const portrait=page.locator('.player-cell-avatar img');
  if(await portrait.count())await portrait.first().evaluate(img=>img.decode().catch(()=>{}));
  const audit=async view=>{
   const results=await page.evaluate(measureScript(),{minTarget:width<769?44:32,numericRe:NUMERIC_RE.source,barControlSelector:BAR_CONTROL_SELECTOR,tableDeadZonePx:TABLE_DEAD_ZONE_PX,columnPackRatio:COLUMN_PACK_RATIO,gutterSelectors:GUTTER_EDGE_SELECTORS});
   const failures=results.filter(x=>!x.ok);
   reports.push({width,scenario,view,failures});console.log(JSON.stringify(reports.at(-1)));
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  };
  await audit('initial');
  await page.screenshot({path:`${output}/${scenario}-${width}.png`,fullPage:true});
  if(!['loading','error','preseason'].includes(state)){
   for(const name of ['Season so far','Rest of season','This week']){
    await page.getByRole('tab',{name,exact:true}).click();
    await audit(name);
    await page.screenshot({path:`${output}/${scenario}-${name.replaceAll(' ','-')}-${width}.png`,fullPage:true});
   }
  }
  if(state==='ready'){
   await page.getByRole('button',{name:'All games (7)',exact:true}).click();
   assert.equal(await page.locator('.player-profile-table tbody tr').count(),7);
   await page.getByRole('button',{name:'Recent games',exact:true}).click();
   assert.equal(await page.locator('.player-profile-table tbody tr').count(),5);
   await page.getByRole('tab',{name:'This week',exact:true}).press('ArrowRight');
   assert.equal(await page.getByRole('tab',{name:'Season so far',exact:true}).getAttribute('aria-selected'),'true');
   await page.locator('.player-profile-disclosure summary').first().click();
   await page.getByText('Limited at practice this week.',{exact:true}).waitFor();
   assert.equal(await page.getByText('No availability flags',{exact:false}).count(),0);
  }
  if(state==='questionable'){
   await page.locator('.player-profile-injury summary').click();
   await audit('injury');
   await page.screenshot({path:`${output}/injury-open-${width}.png`,fullPage:true});
   await page.keyboard.press('Escape');
   assert.equal(await page.locator('.player-profile-injury').evaluate(e=>e.open),false);
   assert.equal(await page.getByRole('dialog').isVisible(),true);
  }
  if(state==='preseason')assert.equal(await page.getByRole('tab').count(),0);
  if(state==='missing')assert.equal(await page.getByText('No recorded games available yet.',{exact:true}).isVisible(),true);
  await page.getByRole('button',{name:'Close player details',exact:true}).click();
  assert.equal(await page.getByRole('dialog').count(),0);
  assert.equal(await open.evaluate(e=>document.activeElement===e),true);
  assert.notEqual(await page.evaluate(()=>document.body.style.overflow),'hidden');
  assert.deepEqual(errors,[]);
  await page.close();
 }
 await writeFile(`${output}/checks.json`,JSON.stringify(reports,null,2));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
