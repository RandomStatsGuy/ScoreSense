import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),out=path.join(root,'outputs/agent/release-regressions'),stage='mobile';
const folder=path.join(out,stage+'-survey');await fs.mkdir(folder,{recursive:true});
const require=createRequire(path.join(root,'frontend/package.json')),{build}=require('esbuild'),{chromium}=require('playwright');
const fixtures=['navigation-accessibility'];
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
async function open(fixture,query={}){const page=await browser.newPage({viewport:{width:390,height:900},serviceWorkers:'block'});page.setDefaultTimeout(12000);page.setDefaultNavigationTimeout(60000);await page.route('**/*',r=>new URL(r.request().url()).origin===base&&!new URL(r.request().url()).pathname.startsWith('/api/')?r.continue():r.abort());await page.goto(`${base}/test-fixtures/${fixture}.html?${new URLSearchParams(query)}`,{waitUntil:'domcontentloaded'});return page;}
let page;
try {
 for (const width of [320,390]) {
  page=await open('navigation-accessibility',{fixturePool:'1',fixturePoolError:'1'});
  await page.setViewportSize({width,height:844});
  await page.getByText('Example player pool unavailable',{exact:true}).waitFor();
  assert.equal(await page.getByRole('status',{name:'Loading players',exact:true}).count(),0,'error ends loading');
  assert.equal(await page.getByText('No players available.',{exact:true}).count(),0,'error is not an empty pool');
  await page.evaluate(()=>{window.__navigationFixture.poolError=false;});
  await page.getByRole('button',{name:'Retry players',exact:true}).click();
  await page.getByText('Frank Gore Jr.',{exact:true}).first().waitFor();
  const requests=await page.evaluate(()=>window.__navigationFixture.requests.filter(r=>/value-sheet|value-overlay/.test(r.path)));
  assert.equal(requests.length,2,'one initial read and one explicit retry');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:path.join(out,`loading-retry-${width}.png`)});
  reports.push({id:'pool-retry',width,status:'pass',requests});await page.close();page=null;
 }
 page=await open('navigation-accessibility',{fixturePool:'1',fixturePoolDelay:'1200'});
 await page.waitForFunction(()=>window.__navigationFixture.requests.some(r=>r.path.includes('/value-sheet')));
 await page.getByRole('button',{name:'Free agents, choose destination',exact:true}).click();
 await page.getByRole('dialog',{name:'Go to',exact:true}).getByRole('button',{name:'This Week',exact:true}).click();
 await page.getByRole('button',{name:'This Week, choose destination',exact:true}).click();
 await page.getByRole('dialog',{name:'Go to',exact:true}).getByRole('button',{name:'Free agents',exact:true}).click();
 await page.getByText('Frank Gore Jr.',{exact:true}).first().waitFor();
 assert.equal((await page.evaluate(()=>window.__navigationFixture.requests.filter(r=>r.path.includes('/value-sheet')))).length,1,'navigation shares the pending producer');
 reports.push({id:'pending-navigation',status:'pass'});await page.close();page=null;
 page=await open('navigation-accessibility',{fixturePool:'1',fixturePoolDelay:'31500'});
 await page.setViewportSize({width:320,height:844});
 await page.getByText('Players took too long to load. Try again.',{exact:true}).waitFor({timeout:35000});
 assert.equal(await page.getByRole('status',{name:'Loading players',exact:true}).count(),0,'deadline ends loading');
 await page.screenshot({path:path.join(out,'loading-timeout-320.png')});
 await page.evaluate(()=>{window.__navigationFixture.poolDelay=120;});
 await page.getByRole('button',{name:'Retry players',exact:true}).click();
 await page.getByText('Frank Gore Jr.',{exact:true}).first().waitFor();
 assert.equal((await page.evaluate(()=>window.__navigationFixture.requests.filter(r=>r.path.includes('/value-sheet')))).length,2,'timeout releases the shared key for retry');
 reports.push({id:'pool-deadline-retry',width:320,status:'pass'});await page.close();page=null;

} catch(e) {reports.push({status:'fail',error:e.stack,body:await page?.locator('body').innerText(),requests:await page?.evaluate(()=>window.__navigationFixture.requests)});await page?.screenshot({path:path.join(out,'loading-failure.png')});console.log(e.stack);process.exitCode=1;}
finally {await fs.writeFile(path.join(out,'loading.json'),JSON.stringify(reports,null,2));console.log(JSON.stringify(reports));await browser.close();server.close();}
