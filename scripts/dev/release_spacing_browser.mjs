import {launchReleaseBrowser,releaseOutputRoot,waitForMeasuredLayout} from './release_browser.mjs';
import {measureScript,NUMERIC_RE,BAR_CONTROL_SELECTOR,TABLE_DEAD_ZONE_PX,COLUMN_PACK_RATIO,GUTTER_EDGE_SELECTORS} from './layout_audit.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),out=releaseOutputRoot(root),stage='mobile';
const folder=path.join(out,stage+'-survey');await fs.mkdir(folder,{recursive:true});
const require=createRequire(path.join(root,'frontend/package.json')),{build}=require('esbuild');
const cases=[{id:'room',fixture:'team-room',query:{state:'pregame'},ready:'.team-room-rack'},{id:'rules',fixture:'rules-state',query:{},ready:'.hub-rules-sticky-save'},{id:'trades',fixture:'trades-mobile',query:{},ready:'.hub-trade-desk-bar'}];
const fixtures=[...new Set(cases.map(x=>x.fixture))];
await build({absWorkingDir:root,entryPoints:fixtures.map(f=>`frontend/test-fixtures/${f}.jsx`),bundle:true,jsx:'automatic',format:'esm',outdir:path.join(folder,'bundles'),logLevel:'error',resolveExtensions:['.mjs','.js','.jsx','.json'],external:['/art/*','/fonts/*','/assets/*'],loader:{'.js':'jsx','.svg':'dataurl','.png':'dataurl','.webp':'dataurl','.woff2':'dataurl','.jpg':'dataurl'},define:{'process.env.NODE_ENV':'"production"','import.meta.env':JSON.stringify({DEV:false,PROD:true,MODE:'test',BASE_URL:'/'})}});
const server=createServer(async(req,res)=>{try {
 const u=new URL(req.url,'http://127.0.0.1'),match=u.pathname.match(/^\/test-fixtures\/([\w-]+)\.html$/),bundle=u.pathname.match(/^\/bundles\/([\w-]+)\.(js|css)$/);
 if(match&&fixtures.includes(match[1])){res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/bundles/${match[1]}.css"><script src="/theme-init.js"></script></head><body><div id="root"></div><script type="module" src="/bundles/${match[1]}.js"></script></body></html>`);return;}
 if(bundle&&fixtures.includes(bundle[1])){res.setHeader('Content-Type',bundle[2]==='js'?'text/javascript':'text/css');res.end(await fs.readFile(path.join(folder,'bundles',bundle[1]+'.'+bundle[2])));return;}
 const pub=path.join(root,'frontend/public'),asset=path.resolve(pub,'.'+u.pathname);
 if(asset.startsWith(pub+path.sep)&&/\.(png|svg|webp|woff2?|ttf|js|css)$/.test(asset)){const type={'.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2','.js':'text/javascript','.css':'text/css'};res.setHeader('Content-Type',type[path.extname(asset)]||'application/octet-stream');res.end(await fs.readFile(asset));return;}
 res.writeHead(404);res.end();
}catch{res.writeHead(404);res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`,browser=await launchReleaseBrowser(),reports=[];

const reportsOut=path.join(out,'browser');await fs.mkdir(reportsOut,{recursive:true});
try {
const jobs=cases.flatMap(c=>[320,390,768,1280].flatMap(width=>['dark','light'].map(theme=>({c,width,theme}))));let next=0;
async function worker(){while(next<jobs.length){const {c,width,theme}=jobs[next++];
 const page=await browser.newPage({viewport:{width,height:900},serviceWorkers:'block',reducedMotion:'reduce'}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));let report={id:c.id,width,theme,errors};
 try{
 await page.addInitScript(theme=>localStorage.setItem('scoresense-color-theme',theme),theme);
 await page.route('**/*',r=>{const u=new URL(r.request().url());return u.origin!==base||u.pathname.startsWith('/api/')?r.abort():r.continue();});
 await page.goto(`${base}/test-fixtures/${c.fixture}.html?${new URLSearchParams({...c.query,theme,color:theme})}`,{waitUntil:"domcontentloaded"});
 await page.locator(c.id==='room'&&width>768?'.team-room-heading':c.ready).first().waitFor({timeout:15000});
 await waitForMeasuredLayout(page);
 await page.addStyleTag({content:'@media(max-width:768px){:root.has-fantasy-chat-launcher .hub-trade-desk-bar {grid-template-columns:minmax(0,1fr);} :root.has-fantasy-chat-launcher .hub-trade-desk-bar > button {width:100%;} .hub-rules-sticky-save {display:flex;flex-direction:column;}}'}); if(width<=768&&c.id!=='room')assert.equal(await page.locator(c.ready).evaluate(e=>getComputedStyle(e).gridTemplateColumns.split(' ').length),2,'Late page/chat styles retain two action columns'); await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(200);
 await page.locator(c.id==='room'&&width>768?'.team-room-heading':c.ready).first().scrollIntoViewIfNeeded();
 report.geometry=await page.evaluate(()=>{const box=e=>{if(!e)return null;let r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom};};const panel=document.querySelector('.team-room-rack,.hub-rules-sticky-save,.hub-trade-desk-bar'),chat=document.querySelector('.fantasy-chat-launcher-a');return {overflow:document.documentElement.scrollWidth>innerWidth,panel:box(panel),chat:box(chat),position:panel?.dataset.bottomPosition,theme:document.documentElement.dataset.theme,buttons:[...(panel||document.createElement("div")).querySelectorAll('button')].filter(e=>e.getBoundingClientRect().width).map(e=>({text:e.textContent,box:box(e)})),contextOutside:!panel?.querySelector('#rules-save-context')};});
 assert.equal(report.geometry.theme,theme,'active theme');assert.equal(report.geometry.overflow,false,'page overflow');assert.equal(errors.length,0,'runtime errors');
 if(width<=768){assert.ok(report.geometry.panel.h<(c.id==='room'?240:160),'compact action height');for(const b of report.geometry.buttons)assert.ok(b.box.h>=43.5,'44px action '+b.text);let a=report.geometry.panel,b=report.geometry.chat;if(b)assert.ok(a.right<=b.x||a.x>=b.right||a.bottom<=b.y||a.y>=b.bottom,'chat overlaps action panel');}
 if(c.id==='rules')assert.ok(report.geometry.contextOutside);
 report.screenshot=`${c.id}-${width}-${theme}.png`;await page.screenshot({path:path.join(reportsOut,report.screenshot),fullPage:false});report.status='pass';
 }catch(e){report.status='fail';report.error=e.message;await page.screenshot({path:path.join(reportsOut,`${c.id}-${width}-${theme}-fail.png`),fullPage:false}).catch(()=>{});}
 reports.push(report);console.log(c.id,width,theme,report.status,report.error||'',JSON.stringify(report.geometry));await page.close();
}}
await Promise.all([worker(),worker(),worker()]);
}finally{await fs.writeFile(path.join(reportsOut,'report.json'),JSON.stringify(reports,null,2));await browser.close();server.close();}
if(reports.some(r=>r.status!=='pass'))process.exitCode=1;
