// Production components with existing isolated fixtures. No real API or external requests.
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {createServer} from "node:http";
import {readFile,mkdir,writeFile} from "node:fs/promises";
import {execFileSync} from "node:child_process";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {LIVING_SURFACES as surfaces} from "../../frontend/src/livingSurfaces.js";
import {auditHighlightInsets,measureScript,NUMERIC_RE,BAR_CONTROL_SELECTOR,TABLE_DEAD_ZONE_PX,COLUMN_PACK_RATIO,GUTTER_EDGE_SELECTORS} from "./layout_audit.mjs";

const root=fileURLToPath(new URL("../../",import.meta.url)),require=createRequire(path.join(root,"frontend/package.json"));
const {build}=require("esbuild"),{chromium}=require("playwright");
const before=process.argv.includes("--before"), phase=before?"before":"after";
const out=path.join(root,"outputs/content-insets",phase),bundles=new Map();
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
 ["projections","projections.weekly","projection-tiers",""],
 ["game-center","hub.game","game-center","state=live"],
 ["salary-sheets","hub.office.current","hub-guided","page=salary"],
 ["draft-controls","hub.room","cursor-controls",""],
 ["account","account.account","utility-mobile","page=account"],
 ["admin","account.admin","utility-mobile","page=admin"],
 ["projections-header","projections.weekly","product-header","view=projections"],
 ["tools-header","tools.dfs","product-header","view=tools"],
].filter(c=>!process.env.POLISH_CASE||process.env.POLISH_CASE.split(",").includes(c[0]));
const theme=await readFile(path.join(root,"frontend/public/theme-init.js"),"utf8");
const baseline=new Map();
const baseRef=process.env.POLISH_BASE || "51b9a216";
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
const insetReports=[];
try{
 for(const width of [1280,390])for(const [name,surface,entry,query] of cases){
  const page=await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce',serviceWorkers:'block'});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(12000);
  await page.route('**/*',route=>route.request().url().startsWith(base)&&!new URL(route.request().url()).pathname.startsWith('/api/')?route.continue():route.abort());
  try{
   await page.goto(`${base}${surfaces[surface]?.route||'/'}?polishFixture=${entry}&${query}`,{waitUntil:'networkidle'});
   await page.locator('#root>*').first().waitFor();
   const insets=await auditHighlightInsets(page);
   const layout=await page.evaluate(measureScript(),{minTarget:width<769?44:32,numericRe:NUMERIC_RE.source,barControlSelector:BAR_CONTROL_SELECTOR,tableDeadZonePx:TABLE_DEAD_ZONE_PX,columnPackRatio:COLUMN_PACK_RATIO,gutterSelectors:GUTTER_EDGE_SELECTORS});
   insetReports.push({name,route:surfaces[surface]?.route||'/',width,insets,layout,errors});
   if(process.env.CAPTURE_INSETS==='1')await page.screenshot({path:path.join(out,`${name}-${width}.png`),fullPage:false});
  }catch(error){insetReports.push({name,width,error:String(error)});}
  await page.close();
 }
}finally{await browser.close();server.close();await writeFile(path.join(out,'inset-review.json'),JSON.stringify(insetReports,null,2));}
const failures=insetReports.flatMap(row=>row.error?[{name:row.name,width:row.width,error:row.error}]:[...row.errors.map(error=>({name:row.name,width:row.width,error})),...row.insets.filter(x=>!x.ok).map(x=>({name:row.name,width:row.width,...x}))]);
console.log(JSON.stringify({reviews:insetReports.length,failures},null,2));
assert.deepEqual(failures,[]);
