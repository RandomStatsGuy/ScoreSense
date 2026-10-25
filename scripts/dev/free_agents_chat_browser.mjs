// Real Free agents rows and chat, isolated from league data and external APIs.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {measureScript,NUMERIC_RE,BAR_CONTROL_SELECTOR,TABLE_DEAD_ZONE_PX,COLUMN_PACK_RATIO,GUTTER_EDGE_SELECTORS} from './layout_audit.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const out=path.join(root,'outputs/agent/release-regressions/free-agents-chat');
await fs.mkdir(out,{recursive:true});
const require=createRequire(path.join(root,'frontend/package.json'));
const {build}=require('esbuild'),{chromium}=require('playwright');
await build({absWorkingDir:root,entryPoints:['frontend/test-fixtures/free-agents-mobile.jsx'],bundle:true,jsx:'automatic',format:'esm',outdir:path.join(out,'bundles'),logLevel:'error',resolveExtensions:['.mjs','.js','.jsx','.json'],external:['/art/*','/fonts/*','/assets/*'],loader:{'.js':'jsx','.svg':'dataurl','.png':'dataurl','.webp':'dataurl','.woff2':'dataurl','.jpg':'dataurl'},define:{'process.env.NODE_ENV':'"production"','import.meta.env':JSON.stringify({DEV:false,PROD:true,MODE:'test',BASE_URL:'/'})}});
const server=createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://127.0.0.1');
 if(url.pathname==='/hub/free-agents'){
  res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/bundles/free-agents-mobile.css"><script src="/theme-init.js"></script></head><body><div id="root"></div><script type="module" src="/bundles/free-agents-mobile.js"></script></body></html>');return;
 }
 const bundle=url.pathname.match(/^\/bundles\/free-agents-mobile\.(js|css)$/);
 if(bundle){res.setHeader('Content-Type',bundle[1]==='js'?'text/javascript':'text/css');res.end(await fs.readFile(path.join(out,'bundles','free-agents-mobile.'+bundle[1])));return;}
 const pub=path.join(root,'frontend/public'),asset=path.resolve(pub,'.'+url.pathname);
 if(asset.startsWith(pub+path.sep)&&/\.(png|svg|webp|woff2?|ttf|js|css)$/.test(asset)){
  res.setHeader('Content-Type',({'.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2','.js':'text/javascript','.css':'text/css'})[path.extname(asset)]||'application/octet-stream');res.end(await fs.readFile(asset));return;
 }
 res.writeHead(404);res.end();
}catch{res.writeHead(404);res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,channel:process.env.RELEASE_BROWSER_CHANNEL||(process.platform==='win32'?'msedge':'chromium'),args:['--no-proxy-server']});
const reports=[];
const auditArgs={numericRe:NUMERIC_RE.source,barControlSelector:BAR_CONTROL_SELECTOR,tableDeadZonePx:TABLE_DEAD_ZONE_PX,columnPackRatio:COLUMN_PACK_RATIO,gutterSelectors:GUTTER_EDGE_SELECTORS};
async function audit(page){return page.evaluate(measureScript(),{...auditArgs,minTarget:page.viewportSize().width<=768?44:32});}
async function geometry(page){return page.evaluate(()=>{
 const box=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom};};
 const bubble=document.querySelector('.fantasy-chat-launcher-a'),chat=bubble&&!bubble.hidden?box(bubble):null;
 const actions=[...document.querySelectorAll('.fa-player-bottom button')].map(e=>({label:e.getAttribute('aria-label'),...box(e)}));
 return {chat,actions,overflow:document.documentElement.scrollWidth>innerWidth,scrollY,theme:document.documentElement.dataset.theme};
});}
const overlaps=(a,b)=>a&&b&&Math.min(a.right,b.right)-Math.max(a.x,b.x)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y)>1;
async function alignWithChat(page,index=2){
 await page.locator('.fa-acquire').nth(index).evaluate(e=>{
  const c=document.querySelector('.fantasy-chat-launcher-a').getBoundingClientRect(),r=e.getBoundingClientRect();
  window.scrollBy(0,r.top+r.height/2-c.top-c.height/2);
 });
}
try{
 const jobs=[320,390,768,1024,1280,1440].flatMap(width=>['dark','light'].flatMap(theme=>['add','bid','claim','locked'].map(state=>({width,theme,state}))));
 jobs.push(...[320,390].flatMap(width=>['dark','light'].map(theme=>({width,theme,state:'bid',target:true}))));
 jobs.push(...[320,390].flatMap(width=>['dark','light'].map(theme=>({width,theme,state:'large',pagination:true}))));
 let next=0;
 async function worker(){while(next<jobs.length){
  const {width,theme,state,target,pagination}=jobs[next++],id=`${state}-${width}-${theme}${target?'-target':''}`;
  const page=await browser.newPage({viewport:{width,height:900},serviceWorkers:'block',reducedMotion:'reduce'}),errors=[];
  let report={id,width,theme,state};page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(12000);
  try{
   await page.addInitScript(theme=>localStorage.setItem('scoresense-color-theme',theme),theme);
   await page.route('**/*',r=>new URL(r.request().url()).origin===base&&!new URL(r.request().url()).pathname.startsWith('/api/')?r.continue():r.abort());
   await page.goto(`${base}/hub/free-agents?state=${state}&chat=1&long=1${target?'&longStarter=1':''}`,{waitUntil:'domcontentloaded'});
   await page.locator('.fa-acquire').first().waitFor();await page.locator('.fantasy-chat-bubble-a').waitFor();await page.evaluate(()=>document.fonts.ready);
   if(target) {
    await page.getByRole('button',{name:/^WR2: Jaxon Smith-Njigba/}).click();
    // Wider platform font metrics must not let nowrap context hit the action.
    await page.addStyleTag({content:'.fa-tick-key {font-family:Arial,sans-serif;font-size:14px;}'});
   }
   if(pagination){
    const more=page.getByRole('button',{name:'Show more players',exact:true});await more.waitFor();
    const align=()=>more.evaluate(e=>{const b=document.querySelector('.fantasy-chat-launcher-a').getBoundingClientRect(),r=e.getBoundingClientRect();scrollBy(0,r.y+r.height/2-b.y-b.height/2);});
    const clear=async()=>!overlaps(await more.boundingBox().then(r=>({...r,w:r.width,h:r.height,right:r.x+r.width,bottom:r.y+r.height})),(await geometry(page)).chat);
    await align();assert.ok(await clear(),'pagination action clears chat while scrolling');
    const unsafe=await page.addStyleTag({content:'button[data-chat-safe-actions="control"]{max-inline-size:none!important;margin-inline-end:0!important}'});
    await align();assert.equal(await clear(),false,'negative control recreates the live pagination overlap');
    await unsafe.evaluate(e=>e.remove());await align();assert.ok(await clear(),'restoring the shared control lane clears pagination');
    assert.ok((await audit(page)).filter(x=>['overlay-clearance','chat-anchor'].includes(x.rule)).every(x=>x.ok),'pagination uses the shared overlay audit');
    report.paginationScreenshot=id+'-pagination.png';await page.screenshot({path:path.join(out,report.paginationScreenshot)});
    const before=await page.locator('.fa-player').count();await more.click();assert.ok(await page.locator('.fa-player').count()>before,'pagination reveals more players');
   }
   await alignWithChat(page);
   const g=await geometry(page);report.geometry=g;
   const contextFits=()=>page.locator('.fa-player').evaluateAll(rows=>rows.every(row=>{const text=row.querySelector('.fa-tick-key'),action=row.querySelector('.fa-acquire');return !text||!action||text.getBoundingClientRect().right<action.getBoundingClientRect().left;}));
   if(target) {
    assert.ok(await contextFits(),'long comparison label clears acquisition action');
    if(width===320){
     await page.locator('.fa-tick-key').evaluateAll(labels=>labels.forEach(e=>e.classList.remove('hub-wrap-copy')));
     assert.equal(await contextFits(),false,'negative control recreates the nowrap collision');
     await page.locator('.fa-tick-key').evaluateAll(labels=>labels.forEach(e=>e.classList.add('hub-wrap-copy')));
     assert.ok(await contextFits(),'restored shared wrapping clears the action');
    }
   }
   assert.equal(g.theme,theme);assert.equal(g.overflow,false,'horizontal overflow');
   assert.ok(g.actions.every(a=>!overlaps(a,g.chat)),'chat covers a scrolling player action');
   assert.ok(g.actions.every(a=>a.h>=43.5),'acquisition targets stay 44px');
   const checks=await audit(page);report.layout=checks;
   assert.ok(checks.filter(x=>['overlay-clearance','chat-anchor'].includes(x.rule)).every(x=>x.ok),'shared overlay audit');
   // Prove the detector catches the original collision without focusing Add.
   await page.addStyleTag({content:'[data-chat-safe-actions]{padding-inline-end:0!important}'});
   await alignWithChat(page);const unsafe=await geometry(page);
   assert.ok(unsafe.actions.some(a=>overlaps(a,unsafe.chat)),'negative control must recreate the overlap');
   assert.ok((await audit(page)).some(x=>x.rule==='overlay-clearance'&&!x.ok),'audit must reject the unfocused regression');
   await page.locator('style').last().evaluate(e=>e.remove());
   await alignWithChat(page);
   report.screenshot=`${id}.png`;await page.screenshot({path:path.join(out,report.screenshot)});
   if(state!=='locked'){
    const target=page.locator('.fa-acquire').nth(2);
    await target.click();await page.getByRole('dialog').waitFor();
    assert.equal(await page.evaluate(()=>window.fixtureWrites.length),0,'opening sheet does not acquire player');
    await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});
    assert.equal(await target.evaluate(e=>document.activeElement===e),true,'focus returns to row action');
    assert.ok((await audit(page)).filter(x=>x.rule==='overlay-clearance').every(x=>x.ok),'returned focus clears chat');
   }
   // Hidden chat releases the lane; no page-specific spacing remains.
   await page.locator('.fantasy-chat-bubble-a').press('Delete');await page.locator('.fantasy-chat-hide-a').click();
   await page.locator('.fantasy-chat-bubble-a').waitFor({state:'hidden'});
   assert.equal(await page.locator('[data-chat-safe-actions]').first().evaluate(e=>parseFloat(getComputedStyle(e).paddingInlineEnd)),0,'dismissed chat releases reserved lane');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   assert.equal(await page.evaluate(()=>window.fixtureWrites.length),0,'no acquisition writes');
   assert.deepEqual(errors,[]);report.status='pass';
  }catch(e){report.status='fail';report.error=e.message;await page.screenshot({path:path.join(out,id+'-fail.png')}).catch(()=>{});}
  reports.push(report);console.log(id,report.status,report.error||'');await page.close();
 }}
 await Promise.all([worker(),worker(),worker()]);
}finally{await fs.writeFile(path.join(out,'report.json'),JSON.stringify(reports,null,2));await browser.close();server.close();}
assert.ok(reports.length===56&&reports.every(r=>r.status==='pass'),'all 56 chat-clearance scenarios must pass');
