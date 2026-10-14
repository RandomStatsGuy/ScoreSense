// Production components with existing isolated fixtures. No real API or external requests.
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {createServer} from "node:http";
import {readFile,mkdir,writeFile} from "node:fs/promises";
import {execFileSync} from "node:child_process";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {LIVING_SURFACES as surfaces} from "../../frontend/src/livingSurfaces.js";
import {measureScript,minTargetForWidth,NUMERIC_RE,BAR_CONTROL_SELECTOR,TABLE_DEAD_ZONE_PX,COLUMN_PACK_RATIO,GUTTER_EDGE_SELECTORS} from "./layout_audit.mjs";

const root=fileURLToPath(new URL("../../",import.meta.url)),require=createRequire(path.join(root,"frontend/package.json"));
const {build}=require("esbuild"),{chromium}=require("playwright");
const before=process.argv.includes("--before"), phase=before?"before":"after";
const out=path.join(root,"outputs/site-polish",phase),bundles=new Map(),reports=[];
await mkdir(out,{recursive:true});
const cases=[
 ["home","hub.home","mobile-home",""],
 ["home-empty","hub.home","mobile-home","state=empty"],
 ["week","hub.week","week-overview","state=ready"],
 ["week-live","hub.week","week-overview","state=live"],
 ["week-long","hub.week","week-overview","state=ready&long=1&long-opponent=1"],
 ["room","hub.roster","team-room","state=pregame"],
 ["room-live","hub.roster","team-room","state=live"],
 ["lineup","hub.roster","week-overview","state=ready&view=myteam&lineup=1"],
 ["agents","hub.available","free-agents-mobile","long=1"],
 ["agents-empty","hub.available","free-agents-mobile","state=empty"],
 ["trades","hub.trades","trades-transfers","state=salary"],
 ["rosters","hub.rosters","rosters",""],
 ["rules","hub.rules","hub-guided","page=rules"],
 ["office","hub.office.current","hub-guided","page=contracts"],
 ["office-pick","hub.office.rosters","hub-guided","page=contracts&state=snake"],
 ["access","hub.office.access","hub-guided","page=access"],
 ["insights","hub.insights","insights-hosts",""],
 ["insights-empty","hub.insights","insights-hosts","state=empty"],
 ["vibes","hub.vibes","site-polish",""],
 ["dfs","tools.dfs","dfs-workspace",""],
 ["update","tools.dfs","site-polish","page=update"],
].filter(c=>!process.env.POLISH_CASE||process.env.POLISH_CASE.split(",").includes(c[0]));
const theme=await readFile(path.join(root,"frontend/public/theme-init.js"),"utf8");
const baseline=new Map();
const baseRef=process.env.POLISH_BASE || "origin/develop";
const baselinePlugin={name:"polish-before",setup(builder){
 builder.onLoad({filter:/frontend[\\/]src[\\/].*\.(jsx?|css)$/},async args=>{
  const relative=path.relative(root,args.path).split(path.sep).join("/");
  if(!baseline.has(relative)) {
   try{baseline.set(relative,execFileSync("git",["show",baseRef+":"+relative],{cwd:root,encoding:"utf8",stdio:["ignore","pipe","ignore"]}));}
   catch{baseline.set(relative,null);}
  }
  const contents=baseline.get(relative);
  return contents==null?null:{contents,loader:args.path.endsWith(".css")?"css":args.path.endsWith(".jsx")?"jsx":"js",resolveDir:path.dirname(args.path)};
 });
}};
for(const [, ,entry] of [...cases,...(!before?[["notice","","automatic-projections"]]:[])]) if(!bundles.has(entry)) {
 const shared=["styles.css","styles/product-hierarchy.css","styles/product-rhythm.css","styles/fantasy-phone.css","styles/fantasy-header.css","styles/color-theme.css","styles/fantasy-chat.css","styles/appearance.css"];
 const result=await build({absWorkingDir:path.join(root,"frontend"),stdin:{contents:shared.map(s=>'import "./src/'+s+'";').join("\n")+'\nimport "./test-fixtures/'+entry+'.jsx";',resolveDir:path.join(root,"frontend"),loader:"jsx"},bundle:true,resolveExtensions:[".js",".jsx",".json"],jsx:"automatic",format:"esm",write:false,outdir:"outputs/fixture",external:["/art/*","/fonts/*"],plugins:before?[baselinePlugin]:[],logLevel:"silent",define:{"process.env.NODE_ENV":'"production"',"import.meta.env":'{"DEV":true,"PROD":false}'},loader:{".woff2":"dataurl",".woff":"dataurl",".png":"dataurl",".svg":"dataurl"}});
 bundles.set(entry,{js:result.outputFiles.find(f=>f.path.endsWith(".js")).contents,css:result.outputFiles.find(f=>f.path.endsWith(".css")).contents});
}
const server=createServer(async(req,res)=>{
 const url=new URL(req.url,"http://localhost");
 if(url.pathname.startsWith("/art/")||url.pathname.startsWith("/fonts/")){
  const publicRoot=path.join(root,"frontend/public"),file=path.resolve(publicRoot,"."+decodeURIComponent(url.pathname));
  if(!file.startsWith(publicRoot+path.sep)){res.writeHead(404);res.end();return;}
  try{const bytes=await readFile(file);res.setHeader("Content-Type",file.endsWith(".svg")?"image/svg+xml":file.endsWith(".woff2")?"font/woff2":"application/octet-stream");res.end(bytes);}catch{res.writeHead(404);res.end();}return;
 }
 const asset=url.pathname.match(/^\/_fixtures\/([\w-]+)\.(js|css)$/);
 const spec=cases.find(c=>surfaces[c[1]].route===url.pathname);
 const entry=asset?.[1]||url.searchParams.get("polishFixture")||spec?.[2],b=bundles.get(entry);
 if(!b){res.writeHead(404);res.end();return;}
 res.setHeader("Cache-Control","no-store");
 res.setHeader("Content-Type",asset?.[2]==="js"?"text/javascript":asset?"text/css":"text/html");
 res.end(asset?b[asset[2]]:`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><script>${theme}</script><link rel="stylesheet" href="/_fixtures/${entry}.css"></head><body><div id="root"></div><script type="module" src="/_fixtures/${entry}.js"></script></body></html>`);
});
await new Promise(r=>server.listen(0,"127.0.0.1",r));
const base=`http://127.0.0.1:${server.address().port}`;
if(process.argv.includes("--serve")){console.log(base);await new Promise(()=>{});}
const browser=await chromium.launch({headless:true});
try{
 for(const width of [1280,820,390,320]) for(const [name,surface,entry,query] of cases){
  const page=await browser.newPage({viewport:{width,height:1000},reducedMotion:"reduce",serviceWorkers:"block"}),errors=[];
  page.setDefaultTimeout(12000);
  page.on("pageerror",e=>errors.push(e.message));
  await page.route("**/*",route=>route.request().url().startsWith(base)&&!new URL(route.request().url()).pathname.startsWith("/api/")?route.continue():route.abort());
  await page.goto(`${base}${surfaces[surface].route}?polishFixture=${entry}&${query}`,{waitUntil:"networkidle"});
  await page.locator("#root>*").first().waitFor();
  if(name==="agents")await page.locator(".fa-player").first().waitFor();
  if(name.startsWith("office"))await page.locator(".hub-league-rosters-toolbar").waitFor();
  if(name.startsWith("insights"))await page.locator(".hub-insights-overview").waitFor();
  const layout=await page.evaluate(measureScript(),{minTarget:minTargetForWidth(width),numericRe:NUMERIC_RE.source,barControlSelector:BAR_CONTROL_SELECTOR,tableDeadZonePx:TABLE_DEAD_ZONE_PX,columnPackRatio:COLUMN_PACK_RATIO,gutterSelectors:GUTTER_EDGE_SELECTORS});
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
  await page.screenshot({path:path.join(out,`${name}-${width}.png`),fullPage:true});
  if(!before){
   if(name.startsWith("office")){
    assert.equal(await page.getByRole("searchbox").count(),0);
    if(width>768)await page.getByRole("button",{name:/Alexandria Montgomery/}).click();
    else{await page.locator(".hub-league-rosters-toolbar").getByRole("button").first().click();await page.getByRole("option",{name:"Alexandria Montgomery-Sutherland",exact:true}).click();}
    await page.getByRole("searchbox").waitFor();
    assert.equal(await page.getByText("Link Sleeper",{exact:true}).count(),0);
    assert.ok((await page.getByRole("link",{name:"Access & imports",exact:true}).getAttribute("href")).includes("/access"));
   }
   if(name==="agents"){
    await page.getByText("How to read the outlook",{exact:true}).click();
    await page.getByText(/dot = median/).waitFor();
   }
   if(name==="insights")assert.equal(await page.getByText("Best record · tied",{exact:true}).count(),1);
   if(name==="trades"){
    await page.getByRole("button",{name:/Trade with .*Jordan Davis/}).click();
    await page.getByText("Your available players",{exact:true}).waitFor();
    await page.getByText("Partner’s available players",{exact:true}).waitFor();
    assert.equal(await page.locator(".ss-trade-metric").count(),0);
    await page.getByText("Select players to preview projected impact.",{exact:true}).filter({visible:true}).waitFor();
    assert.equal(await page.locator(".ss-trade-progress [aria-current='step']").innerText(),"Players");
    await page.screenshot({path:path.join(out,`trade-empty-${width}.png`),fullPage:true});
    const columns=page.locator(".hub-trade-party-col");
    await columns.nth(0).locator(".ss-trade-square").first().click();
    await columns.nth(1).locator(".ss-trade-square").first().click();
    assert.equal(await page.locator(".ss-trade-metric").filter({visible:true}).count(),4);
    await page.getByRole("button",{name:/^Review trade/}).click();
    await page.getByRole("dialog").waitFor();
    assert.equal(await page.locator(".ss-trade-progress [aria-current='step']").innerText(),"Review");
    await page.getByRole("button",{name:"Close trade review",exact:true}).click();
    await page.screenshot({path:path.join(out,`trade-players-${width}.png`),fullPage:true});
   }
   if(name==="vibes"){
    await page.getByRole("button",{name:"Rate Josh Allen higher",exact:true}).click();
    const ranking=page.locator(".hub-vibes-ranking");
    if(!await ranking.evaluate(e=>e.open))await ranking.locator(":scope > summary").click();
    await ranking.locator("td small").getByText("Adjusted",{exact:true}).waitFor();
    await page.locator(".hub-vibes-undo").click();
    assert.equal(await ranking.locator("td small").getByText("Unrated",{exact:true}).count(),6);
   }
   if(name==="insights-empty")assert.equal(await page.getByText("No completed championships recorded yet.",{exact:true}).count(),1);
   if(name==="update"){
    const disclosure=page.locator(".dfw-input-update details");
    assert.equal(await disclosure.getAttribute("open"),null);
    await disclosure.locator("summary").click();
    assert.equal(await page.locator(".dfw-update-list article").count(),8);
    await page.getByRole("button",{name:"Next input changes",exact:true}).click();
    assert.equal(await page.locator(".dfw-update-list article").count(),4);
    await page.getByRole("button",{name:"Use reviewed inputs",exact:true}).click();
    await page.getByText("Input change record",{exact:true}).waitFor();
    assert.equal(await disclosure.getAttribute("open"),null);
    await page.getByRole("button",{name:"Undo input update",exact:true}).click();
    await page.getByText(/Update undone/).waitFor();
   }
  }
  assert.deepEqual(errors,[]);
  assert.equal(overflow,false,`${name}@${width} overflow`);
  reports.push({name,surface,width,errors,overflow,layout});
  console.log(JSON.stringify({name,width,failures:layout.filter(r=>!r.ok)}));
  await page.close();
 }
 if(!before && !process.env.POLISH_CASE) for(const width of [1280,390]){
  const page=await browser.newPage({viewport:{width,height:1000}});
  await page.route("**/*",route=>route.request().url().startsWith(base)&&!new URL(route.request().url()).pathname.startsWith("/api/")?route.continue():route.abort());
  await page.goto(base+"/projections/weekly?polishFixture=automatic-projections",{waitUntil:"networkidle"});
  await page.getByText("Josh Allen",{exact:true}).first().waitFor();
  await page.evaluate(()=>{window.fixturePublish();window.fixtureRefreshState="completed";window.dispatchEvent(new Event("focus"));});
  await page.locator(".projection-refresh-status").waitFor();
  assert.match(await page.locator(".projection-refresh-status").innerText(),/New projections are ready/);
  await page.getByRole("link",{name:"Fantasy",exact:true}).filter({visible:true}).first().click();
  await page.locator(".projection-refresh-status").waitFor({state:"detached"});
  await page.getByRole("link",{name:"Tools",exact:true}).filter({visible:true}).first().click();
  assert.equal(await page.locator(".projection-refresh-status").count(),0);
  console.log(JSON.stringify({name:"refresh-route-scope",width,passed:true}));
  await page.close();
 }
 await writeFile(path.join(out,process.env.POLISH_CASE?"report-"+process.env.POLISH_CASE.replaceAll(",","-")+".json":"report.json"),JSON.stringify(reports,null,2));
 if(!before && reports.some(r=>r.layout.some(check=>!check.ok)))process.exitCode=1;
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
