import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import {measureScript, NUMERIC_RE, BAR_CONTROL_SELECTOR, TABLE_DEAD_ZONE_PX,
  COLUMN_PACK_RATIO, GUTTER_EDGE_SELECTORS} from "./layout_audit.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(path.join(root, "frontend/package.json"));
const {build} = require("esbuild");
const {chromium} = require("playwright");
const out = path.join(root, "outputs/automatic-refresh");
await fs.mkdir(out, {recursive:true});
await build({entryPoints:[path.join(root,"frontend/test-fixtures/automatic-projections.jsx")],
  outfile:path.join(out,"bundle.js"), bundle:true, resolveExtensions:[".js",".jsx",".json"], format:"esm", jsx:"automatic",
  external:["/art/*"], define:{"import.meta.env":"{}", "process.env.NODE_ENV":'"development"'},
  loader:{".woff2":"file", ".woff":"file", ".ttf":"file", ".png":"file", ".svg":"file", ".jpg":"file"}, logLevel:"warning"});
const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/theme-init.js"></script><link rel="stylesheet" href="/bundle.css"></head><body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>';
const mime = {".js":"text/javascript", ".css":"text/css", ".woff2":"font/woff2", ".woff":"font/woff", ".svg":"image/svg+xml", ".png":"image/png"};
// Every browser request is fulfilled locally; no running app or league is contacted.
const base = "http://scoresense.test";
const browser = await chromium.launch({headless:true,channel:"msedge"});
const reports=[];
try {
 for(const width of [1280,390])for(const routePath of ["/projections/weekly","/projections/season"]){
  const page=await browser.newPage({viewport:{width,height:1000}});
  page.setDefaultTimeout(20000);
  await page.route("**/*",async route=>{
   const url=new URL(route.request().url());
   if (!url.href.startsWith(base)){await route.abort();return;}
   if (url.pathname === routePath){await route.fulfill({contentType:"text/html",body:html});return;}
   const assetRoot=(url.pathname.startsWith("/art/") || url.pathname === "/theme-init.js") ? path.join(root,"frontend/public") : out;
   const file=path.resolve(assetRoot,`.${url.pathname}`);
   if(!file.startsWith(assetRoot+path.sep)){await route.abort();return;}
   try{await route.fulfill({contentType:mime[path.extname(file)] || "application/octet-stream",body:await fs.readFile(file)});}catch{await route.abort();}
  });
  await page.addInitScript(()=>{
   window.fixtureAutoPolls=new Map();let handle=-1;
   const original=window.setTimeout,clear=window.clearTimeout;
   window.setTimeout=(fn,ms,...args)=>ms === 300000 ? (window.fixtureAutoPolls.set(handle,()=>fn(...args)),handle--) : original(fn,ms,...args);
   window.clearTimeout=id=>id<0 ? window.fixtureAutoPolls.delete(id) : clear(id);
  });
  const errors=[];page.on("pageerror",error=>errors.push(error.message));
  await page.goto(`${base}${routePath}`,{waitUntil:"domcontentloaded"});
  try{await page.getByText("Josh Allen",{exact:true}).last().waitFor();}
  catch(error){await page.screenshot({path:path.join(out,`debug-${width}.png`),fullPage:true});console.log(JSON.stringify({errors,body:await page.locator("body").innerText()}));throw error;}
  assert.equal(errors.length,0,errors.join("\n"));
  assert.equal(await page.getByText(/Automatic projection update failed/).count(),0);
  const count=await page.evaluate(()=>window.fixtureRequests.filter(item=>/\/api\/(predict|draft|ros)\//.test(item.path) && !item.path.includes("changes")).length);
  await page.evaluate(()=>{window.fixturePublish();[...window.fixtureAutoPolls.values()].forEach(tick=>tick());});
  await page.waitForFunction(before=>window.fixtureRequests.filter(item=>/\/api\/(predict|draft|ros)\//.test(item.path) && !item.path.includes("changes")).length>before,count);
  await page.waitForFunction(()=>document.body.innerText.includes("24.4") || document.body.innerText.includes("244"));
  const auditOptions={minTarget:width===390?44:32,numericRe:NUMERIC_RE.source,barControlSelector:BAR_CONTROL_SELECTOR,tableDeadZonePx:TABLE_DEAD_ZONE_PX,columnPackRatio:COLUMN_PACK_RATIO,gutterSelectors:GUTTER_EDGE_SELECTORS};
  const baseline=(await page.evaluate(measureScript(),auditOptions)).filter(check=>!check.ok);
  await page.evaluate(()=>{window.fixtureFail=true;[...window.fixtureAutoPolls.values()].forEach(tick=>tick());});
  await page.getByText("Automatic projection update failed. Showing the last successful forecast.",{exact:true}).waitFor();
  assert.ok(await page.getByText("Josh Allen",{exact:true}).count()>0,"Saved rows remain visible on failure");
  assert.equal(await page.evaluate(()=>window.fixtureRequests.filter(item=>item.method!=="GET").length),0);
  await page.screenshot({path:path.join(out,`${routePath.split("/").pop()}-${width}.png`),fullPage:true});
  const audit=await page.evaluate(measureScript(),{minTarget:width===390?44:32,numericRe:NUMERIC_RE.source,
   barControlSelector:BAR_CONTROL_SELECTOR,tableDeadZonePx:TABLE_DEAD_ZONE_PX,columnPackRatio:COLUMN_PACK_RATIO,gutterSelectors:GUTTER_EDGE_SELECTORS});
  const failures=audit.filter(check=>!check.ok);
  assert.deepEqual(failures,baseline,"Refresh feedback causes no layout regressions");
  reports.push({width,route:routePath,audit,baseline});
  console.log(JSON.stringify({width,route:routePath,publication:"PASS",failure:"PASS",writes:0,layoutFailures:failures}));
  await page.close();
 }
 await fs.writeFile(path.join(out,"projection-audit.json"),JSON.stringify(reports,null,2));
}finally{await browser.close();}
