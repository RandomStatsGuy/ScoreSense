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
await build({entryPoints:[path.join(root,"frontend/test-fixtures/weekly-experience.jsx")],
  outfile:path.join(out,"bundle.js"), bundle:true, format:"esm", jsx:"automatic",
  external:["/art/*"], define:{"import.meta.env":"{}", "process.env.NODE_ENV":'"development"'},
  loader:{".woff2":"file", ".woff":"file", ".ttf":"file", ".png":"file", ".svg":"file", ".jpg":"file"}, logLevel:"warning"});
const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/theme-init.js"></script><link rel="stylesheet" href="/bundle.css"></head><body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>';
const mime = {".js":"text/javascript", ".css":"text/css", ".woff2":"font/woff2", ".woff":"font/woff", ".svg":"image/svg+xml", ".png":"image/png"};
// Every browser request is fulfilled locally; no running app or league is contacted.
const base = "http://scoresense.test";
const browser = await chromium.launch({headless:true,channel:"msedge"});
const reports = [];
try {
  for (const width of [1280,390]) {
    const page = await browser.newPage({viewport:{width,height:1000}});
    page.setDefaultTimeout(15_000);
    const errors=[];
    page.on("pageerror",error=>errors.push(error.message));
    await page.route("**/*",async route=>{
      const url=new URL(route.request().url());
      if (!url.href.startsWith(base)) {await route.abort();return;}
      if (url.pathname === "/hub/week") {await route.fulfill({contentType:"text/html",body:html});return;}
      const assetRoot=(url.pathname.startsWith("/art/") || url.pathname === "/theme-init.js") ? path.join(root,"frontend/public") : out;
      const file=path.resolve(assetRoot,`.${url.pathname}`);
      if (!file.startsWith(assetRoot+path.sep)) {await route.abort();return;}
      try {await route.fulfill({contentType:mime[path.extname(file)] || "application/octet-stream",body:await fs.readFile(file)});}
      catch {await route.abort();}
    });
    await page.goto(`${base}/hub/week?state=linked-refresh&refresh-health=scheduled`,{waitUntil:"domcontentloaded"});
    await page.locator("#hub-wcc-calls").getByText("Jalen Hurts",{exact:true}).waitFor();
    await page.waitForFunction(()=>window.fixtureRequests.some(url=>url.includes("freshness")));
    assert.equal(await page.getByText(/Projections stale|Season projection update failed/).count(),0);
    const readsBefore=await page.evaluate(()=>window.fixtureRequests.length);
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(()=>window.fixtureWrites.length),0);
    assert.equal(await page.evaluate(()=>window.fixtureRequests.length),readsBefore,"No browser-triggered refresh work");
    await page.screenshot({path:path.join(out,`scheduled-${width}.png`),fullPage:true});
    await page.evaluate(()=>window.fixtureSetHealth("failed"));
    await page.getByText("Season projection update failed",{exact:true}).first().waitFor();
    await page.screenshot({path:path.join(out,`failed-${width}.png`),fullPage:true});
    const audit=await page.evaluate(measureScript(),{
      minTarget:width === 390 ? 44 : 32,numericRe:NUMERIC_RE.source,
      barControlSelector:BAR_CONTROL_SELECTOR,tableDeadZonePx:TABLE_DEAD_ZONE_PX,
      columnPackRatio:COLUMN_PACK_RATIO,gutterSelectors:GUTTER_EDGE_SELECTORS});
    assert.equal(audit.filter(check=>!check.ok).length,0,JSON.stringify(audit.filter(check=>!check.ok)));
    await page.evaluate(()=>window.fixtureSetHealth("current"));
    await page.getByText("Season projection update failed",{exact:true}).first().waitFor({state:"detached"});
    assert.equal(await page.evaluate(()=>window.fixtureWrites.length),0);
    assert.equal(errors.length,0,errors.join("\n"));
    reports.push({width,route:"/hub/week",behavior:"PASS",audit});
    console.log(JSON.stringify({width,routine:"PASS",failure:"PASS",publication:"PASS",writes:0,layout:"PASS"}));
    await page.close();
  }
  await fs.writeFile(path.join(out,"audit.json"),JSON.stringify(reports,null,2));
} finally {await browser.close();}
