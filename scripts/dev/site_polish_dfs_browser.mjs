// Focused keep/apply/undo checks using the production builder and frozen backups.
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {attachDfsFixture} from "./dfs_fixture_runtime.mjs";
import {readPortfolioBackup} from "../../frontend/src/dfsPortfolioBackup.js";
import {DFS_WORKSPACE_COPY as W,DFS_WORKFLOW_COPY as C,DFS_PORTFOLIO_COPY as P} from "../../frontend/src/dfsToolPresentation.js";
const require=createRequire(new URL("../../frontend/package.json",import.meta.url));
const {chromium}=require("playwright"),out=new URL("../../outputs/site-polish/dfs-frozen/",import.meta.url);
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});
const reports=[];
async function disclosure(page,id){
 const section=page.getByTestId(id).filter({visible:true});
 if(!await section.evaluate(e=>e.open))await section.locator(":scope > summary").click();
 return section;
}
async function backup(page,name){
 const save=page.getByRole("button",{name:"Save this set",exact:true}).filter({visible:true});
 if(await save.count())await save.click();
 await disclosure(page,"dfs-recovery");
 const button=page.getByRole("button",{name:P.backup,exact:true}).filter({visible:true}).last();
 await button.evaluate(e=>{for(let p=e.parentElement;p;p=p.parentElement)if(p.tagName==="DETAILS")p.open=true;});
 const pending=page.waitForEvent("download");
 await button.click();
 const file=new URL(name,out);
 await (await pending).saveAs(fileURLToPath(file));
 return readPortfolioBackup(await readFile(file,"utf8"));
}
try{
 for(const width of [1280,390]){
  const context=await browser.newContext({viewport:{width,height:1000},acceptDownloads:true,reducedMotion:"reduce",serviceWorkers:"block"});
  await context.route("**/*",route=>route.abort());
  await attachDfsFixture(context);
  const page=await context.newPage(),errors=[];
  page.on("pageerror",e=>errors.push(e.message));
  await page.goto("http://127.0.0.1:5173/test-fixtures/dfs-portfolio.html?workflow");
  await page.getByRole("spinbutton",{name:W.count,exact:true}).fill("3");
  await disclosure(page,"dfs-advanced");
  await page.getByRole("button",{name:new RegExp("^"+W.differences+":")}).click();
  await page.getByRole("option",{name:"1",exact:true}).click();
  await page.getByTestId("dfs-generate").click();
  await page.getByText("Built 3 lineups.",{exact:true}).waitFor();
  await page.getByTestId("dfs-flow-review").click();
  const original=await backup(page,"original-"+width+".json");
  await page.getByTestId("dfs-flow-build").click();
  await disclosure(page,"dfs-choose-players");
  const player=page.getByRole("button",{name:"Lock Example 1",exact:true}).locator("xpath=ancestor::tr");
  const projection=()=>player.getByRole("cell").nth(2).innerText();
  await page.evaluate(()=>{window.__portfolioFixture.poolVersion=1;window.__portfolioFixture.publishDataRevision();});
  await page.getByRole("button",{name:W.updatePool,exact:true}).click();
  const update=page.getByTestId("dfs-pool-update-preview");
  await update.getByText(C.updateCount(1),{exact:true}).waitFor();
  assert.equal(await update.locator("details").getAttribute("open"),null);
  assert.equal(await projection(),"10.0");
  await update.locator("summary").click();
  await update.locator(".dfw-update-list article").waitFor();
  await update.getByRole("button",{name:C.keepInputs,exact:true}).click();
  assert.equal(await projection(),"10.0");
  await page.evaluate(()=>window.__portfolioFixture.publishDataRevision());
  await page.getByRole("button",{name:W.updatePool,exact:true}).click();
  await update.getByRole("button",{name:C.applyUpdate,exact:true}).click();
  assert.equal(await projection(),"12.0");
  await update.screenshot({path:fileURLToPath(new URL("applied-"+width+".png",out))});
  await update.getByRole("button",{name:C.undoUpdate,exact:true}).click();
  assert.equal(await projection(),"10.0");
  await page.getByTestId("dfs-flow-review").click();
  assert.deepEqual((await backup(page,"after-"+width+".json")).batches,original.batches);
  assert.deepEqual(errors,[]);
  reports.push({width,passed:true,checks:["details closed until opened","keep retains working pool","apply updates working pool","undo restores working pool","reviewed backups unchanged"]});
  console.log("PASS "+width+": keep/apply/undo; reviewed inputs frozen");
  await context.close();
 }
 await writeFile(new URL("report.json",out),JSON.stringify(reports,null,2));
}finally{await browser.close();}
