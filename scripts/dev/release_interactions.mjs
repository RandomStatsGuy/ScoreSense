import {measureScript,NUMERIC_RE,BAR_CONTROL_SELECTOR,TABLE_DEAD_ZONE_PX,COLUMN_PACK_RATIO,GUTTER_EDGE_SELECTORS} from './layout_audit.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),out=path.join(root,'outputs/agent/release-regressions'),stage='mobile';
const folder=path.join(out,stage+'-survey');await fs.mkdir(folder,{recursive:true});
const require=createRequire(path.join(root,'frontend/package.json')),{build}=require('esbuild'),{chromium}=require('playwright');
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
const base=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({headless:true,channel:process.env.RELEASE_BROWSER_CHANNEL||(process.platform==='win32'?'msedge':'chromium'),args:['--no-proxy-server']});


const reports=[];
let activePage=null,activeCase=null;
async function open(fixture,query={},width=390){const page=await browser.newPage({viewport:{width,height:900},serviceWorkers:'block'});activePage=page;activeCase={fixture,query,width};page.setDefaultTimeout(12000);page.setDefaultNavigationTimeout(60000);await page.route('**/*',r=>new URL(r.request().url()).origin===base&&!new URL(r.request().url()).pathname.startsWith('/api/')?r.continue():r.abort());await page.goto(`${base}/test-fixtures/${fixture}.html?${new URLSearchParams(query)}`,{waitUntil:'domcontentloaded'});return page;}
try{
 if(!reports.some(r=>r.id==='bench')){
 const page=await open('team-room');await page.locator('.team-room-rack').waitFor();
 await page.getByRole('button',{name:/^Pick up Josh Downs/}).click();await page.getByRole('button',{name:'Put back',exact:true}).waitFor();await page.getByRole('button',{name:'Put back',exact:true}).click();
 const audit=async()=>page.evaluate(measureScript(),{minTarget:44,numericRe:NUMERIC_RE.source,barControlSelector:BAR_CONTROL_SELECTOR,tableDeadZonePx:TABLE_DEAD_ZONE_PX,columnPackRatio:COLUMN_PACK_RATIO,gutterSelectors:GUTTER_EDGE_SELECTORS});
 assert.ok((await audit()).filter(r=>r.rule==='overlay-clearance').every(r=>r.ok),'clipped bench clears bubble');
 const style=await page.addStyleTag({content:'.team-room-rack-chips {overflow:visible!important;}'});
 assert.ok((await audit()).some(r=>r.rule==='overlay-clearance'&&!r.ok),'unclipped bench overlap must still fail');await style.evaluate(e=>e.remove());
 await page.getByRole('button',{name:'Open league chat',exact:true}).click();await page.getByRole('dialog').waitFor();await page.keyboard.press('Escape');await page.locator('.fantasy-chat-bubble-a').waitFor();reports.push({id:'bench',status:'pass',evidence:'last chip reachable, pickup/put-back, clipped/unclipped overlay regression, chat open/Escape'});await page.close();

 }
 for(const width of [320,390]) {
 const page=await open('team-room',{bye:'1'});await page.setViewportSize({width,height:900});
 const bye=page.getByRole('button',{name:'Pick up Travis Kelce · Bye',exact:true});await bye.waitFor();await page.screenshot({path:path.join(out,'browser',`room-bye-rack-${width}.png`)});
 assert.equal(await page.getByRole('button',{name:'Pick up Dylan Sampson · 0.0 projected',exact:true}).count(),1,'zero stays numeric');
 assert.equal(await page.getByRole('button',{name:'Pick up Josh Downs · Projection unavailable',exact:true}).count(),1,'missing stays missing');
 await page.getByRole('button',{name:'Bench 3',exact:true}).click();
 await page.getByRole('button',{name:"Open Travis Kelce's locker",exact:true}).waitFor();
 const locker=page.getByRole('button',{name:"Open Travis Kelce's locker",exact:true});
 assert.ok((await locker.innerText()).includes('Bye'));
 assert.ok(!(await locker.innerText()).includes('Projected'));
 await locker.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,'browser',`room-bye-${width}.png`)});
 reports.push({id:'room-bye',width,status:'pass'});await page.close();
 }
 for(const width of [320,390,1280])for(const state of ['salary','pick','invalid']){
 const trade=await open('trades-mobile',{state,fullRoster:'1'},width);await trade.locator('.hub-trade-desk-bar').waitFor();
 await trade.locator('.hub-trade-desk-bar').getByRole('button',{name:'Choose partner',exact:true}).click();await trade.getByRole('button',{name:/Sunday Rivals.*Select/}).click();
 const review=trade.locator('.hub-trade-desk-bar').getByRole('button',{name:/Review trade/});await review.waitFor();const before=await review.boundingBox();
 const row=trade.locator('.hub-trade-player-row:visible').filter({hasText:'Josh Allen'}).first();const rowBefore=await row.boundingBox();
 const scrollBefore=await trade.evaluate(()=>scrollY);const context=trade.locator('.hub-trade-party-col[data-party=send] .hub-trade-roster-context');const contextBefore=await context.innerText();
 const get=trade.locator('.hub-trade-player-row:visible').filter({hasText:'Josh Allen'}).locator('.hub-trade-player-actions > button').first();const clickBefore=await get.evaluate(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,receivesPointer:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),fonts:document.fonts.status};});await get.click();await trade.waitForTimeout(450);
 assert.equal(await context.innerText(),contextBefore,'current-roster context stays current through selection');const rowAfter=await row.boundingBox();
 assert.equal(rowAfter.height,rowBefore.height,'selection retains row height');
 assert.ok(Math.abs(rowAfter.y-rowBefore.y)<1,`selection retains row viewport position: ${JSON.stringify({width,state,rowBefore,rowAfter,scrollBefore,scrollAfter:await trade.evaluate(()=>scrollY),clickBefore,fontsAfter:await trade.evaluate(()=>document.fonts.status)})}`);
 assert.equal(await trade.evaluate(()=>scrollY),scrollBefore,'selection retains page scroll');
 const after=await review.boundingBox();assert.ok(Math.abs(before.y-after.y)<1,`Review stays vertically anchored: ${JSON.stringify({width,state,before,after,bar:await trade.locator('.hub-trade-desk-bar').boundingBox()})}`);
 await get.click();await trade.waitForTimeout(450);
 assert.ok(Math.abs((await row.boundingBox()).y-rowBefore.y)<1,'removal retains row viewport position');
 assert.equal(await trade.evaluate(()=>scrollY),scrollBefore,'removal retains page scroll');assert.ok(Math.abs((await review.boundingBox()).y-before.y)<1,'removal retains Review position');
 await get.click();await trade.waitForTimeout(450);
 if(width<=768){await trade.getByRole('button',{name:'View all 1 moves',exact:true}).click();await trade.getByRole('dialog',{name:'Edit package',exact:true}).waitFor();await trade.getByRole('button',{name:'Remove Josh Allen from package',exact:true}).click();await trade.keyboard.press('Escape');}else{await trade.locator('.hub-trade-desk-bar').getByRole('button',{name:'Remove Josh Allen from package',exact:true}).click();}await trade.getByRole('button',{name:'Undo last package removal',exact:true}).click();await trade.waitForTimeout(450);
 if(state==='invalid'){assert.equal(await review.isEnabled(),false);assert.ok(await trade.getByText('Your team is over the cap.',{exact:true}).count());}
 else {await review.click();await trade.getByRole('region',{name:'Review this trade',exact:true}).waitFor();assert.ok(await trade.getByRole('button',{name:'Propose trade',exact:true}).count());await trade.screenshot({path:path.join(out,'browser',`review-${state}-${width}.png`)});await trade.getByRole('button',{name:/Edit package/}).click();}
 const writes=await trade.evaluate(()=>window.fixtureWrites);assert.ok(writes.every(w=>w.body.validate_only),'only synthetic validation writes');
 reports.push({id:state,width,status:'pass',evidence:'partner, add, row height and Review anchor, package dialog/remove/Undo, review/back or cap blocker; no proposal'});await trade.close();
 }

} catch(e){if(activePage&&!activePage.isClosed())await activePage.screenshot({path:path.join(out,'interaction-failure.png')}).catch(()=>{});reports.push({status:'fail',case:activeCase,error:e.stack});console.log(e.stack);process.exitCode=1;}
finally{await fs.writeFile(path.join(out,'interactions.json'),JSON.stringify(reports,null,2));await browser.close();server.close();}
