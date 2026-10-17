// Real draft-preparation components with isolated synthetic state.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { attachDraftFixture } from "./draft_fixture_runtime.mjs";
import { mockDraftHeroCopy } from "../../frontend/src/DraftHub/mockDraftConfig.js";
import { parseDfsCsv } from "../../frontend/src/dfsCsv.js";
import { measureScript,minTargetForWidth,NUMERIC_RE,BAR_CONTROL_SELECTOR,TABLE_DEAD_ZONE_PX,COLUMN_PACK_RATIO,GUTTER_EDGE_SELECTORS } from "./layout_audit.mjs";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../.."),require=createRequire(path.join(root,"frontend/package.json"));
const {chromium}=require("playwright"),output=path.join(root,"outputs/draft-tools-review");
await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,channel:process.platform==="win32"?"msedge":undefined});
const report={synthetic:true,productionComponents:true,cases:[]};
const regressionsOnly=process.argv.includes("--regressions-only");
async function setup(spec) {
  const context=await browser.newContext({viewport:{width:spec.width||390,height:960},acceptDownloads:true,colorScheme:spec.theme||"dark",reducedMotion:"reduce",serviceWorkers:"block"});
  const errors=[],unexpected=[],mediaFallbacks=[];
  await context.route("**/*",route=>{
    const url=new URL(route.request().url());
    if(url.hostname==="a.espncdn.com"&&url.pathname==="/combiner/i"&&/^\/i\/teamlogos\/nfl\/500\/[a-z]+\.png$/.test(url.searchParams.get("img")||""))mediaFallbacks.push(url.href);
    else unexpected.push(url.href);
    return route.abort();
  });
  await context.addInitScript(theme=>localStorage.setItem("scoresense-color-theme",theme),spec.theme||"dark");
  await attachDraftFixture(context,{fixture:"draft-tools"});
  const page=await context.newPage();page.setDefaultTimeout(8000);page.on("pageerror",error=>errors.push(error.message));
  await page.clock.install({time:new Date("2026-10-17T12:00:00Z")});
  await page.goto(`http://127.0.0.1:5173/test-fixtures/draft-tools.html?${new URLSearchParams({page:spec.page,state:spec.state||"ready",format:spec.format||"auction"})}`);
  await page.locator(".hub-strategy, .mock-draft-tool, .bestball-board, .draft-hub-auth").first().waitFor();
  return {context,page,errors,unexpected,mediaFallbacks};
}
async function choose(page,label,value) {
  await page.getByRole("button",{name:new RegExp(`^${RegExp.escape(label)}:`)}).click();
  await page.getByRole("option",{name:value,exact:true}).click();
}
async function audit(page,spec,state) {
  const name=`${spec.page}-${state}-${spec.width}-${spec.theme}`;
  const layout=await page.evaluate(measureScript(),{minTarget:minTargetForWidth(spec.width),numericRe:NUMERIC_RE.source,barControlSelector:BAR_CONTROL_SELECTOR,tableDeadZonePx:TABLE_DEAD_ZONE_PX,columnPackRatio:COLUMN_PACK_RATIO,gutterSelectors:GUTTER_EDGE_SELECTORS});
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
  await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(output,name+".png"),fullPage:true});
  await page.screenshot({path:path.join(output,name+"-top.png")});
  await fs.writeFile(path.join(output,name+".json"),JSON.stringify({layout,overflow},null,2));
  assert.equal(overflow,false,`${name} page overflow`);assert.deepEqual(layout.filter(row=>!row.ok),[],`${name} layout`);
  return {state,layout,overflow};
}
async function csv(page) {
  const pending=page.waitForEvent("download");pending.catch(()=>{});
  await page.getByRole("button",{name:"Export CSV",exact:true}).click();
  const download=await pending;return parseDfsCsv(await fs.readFile(await download.path(),"utf8"));
}
async function run(spec,task) {
  const {context,page,errors,unexpected,mediaFallbacks}=await setup(spec);
  try {
    const checks=await task(page);
    assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
    assert.equal(await page.evaluate(()=>window.__toolsFixture.writes.some(write=>write.path.includes("/focus"))),false);
    report.cases.push({...spec,passed:true,checks,mediaFallbacks});console.log(`PASS ${spec.page}/${spec.state||"ready"} ${spec.width||390}/${spec.theme||"dark"}`);
  } catch(error) {
    const name=`failure-${spec.page}-${spec.state||"ready"}`;
    await fs.writeFile(path.join(output,name+".txt"),`${error.stack}\n${await page.locator("body").innerText()}`);
    await page.screenshot({path:path.join(output,name+".png"),fullPage:true});
    report.cases.push({...spec,passed:false,error:error.message});console.log(`FAIL ${spec.page}: ${error.message}`);
  } finally {await context.close();}
}
try {
  await run({page:"strategy",state:"scope",width:390,theme:"dark"},async page=>{
    await page.waitForFunction(()=>window.__toolsFixture.writes.some(write=>write.path.includes("preview-a/nomination-queue")));
    await page.evaluate(()=>window.__toolsFixture.switchLeague("preview-b"));
    await page.getByText("Example league B · PPR",{exact:true}).waitFor();
    await page.clock.runFor(450);
    assert.equal(await page.evaluate(()=>window.__toolsFixture.writes.filter(write=>write.path.includes("preview-b/nomination-queue")).length),1,"Same queue IDs must still synchronize to the newly selected league");
  });
  await run({page:"strategy",state:"scope-late",width:390,theme:"dark"},async page=>{
    await page.waitForFunction(()=>typeof window.__toolsFixture.releaseQueueA==="function");
    await page.getByRole("button",{name:"View my rankings",exact:true}).click();
    await page.evaluate(()=>window.__toolsFixture.switchLeague("preview-b"));
    await page.waitForFunction(()=>window.__toolsFixture.writes.some(write=>write.path.includes("preview-b/nomination-queue")));
    await page.evaluate(()=>window.__toolsFixture.releaseQueueA());
    await page.waitForFunction(()=>window.__toolsFixture.queueAComplete);
    await page.clock.runFor(50);
    assert.equal(await page.getByText("Synthetic old-league queue save failed.",{exact:true}).count(),0,"Old-league failure must not replace the current league's status");
  });
  await run({page:"mock",state:"recent-error",format:"snake",width:390,theme:"dark"},async page=>{
    await page.getByRole("alert").waitFor();
    await page.locator(".mock-draft-advanced > summary").click();
    const match=page.locator("#mock-use-league-rules");
    assert.equal(await match.count(),1,"A recent-mocks failure must preserve the successful league context");
    await match.check();
    await page.getByRole("button",{name:"10 teams",exact:true}).waitFor();
    assert.equal(await page.getByRole("button",{name:"10 teams",exact:true}).getAttribute("aria-pressed"),"true");
  });
  await run({page:"bestball",state:"refresh-sort",width:390,theme:"dark"},async page=>{
    await page.getByRole("button",{name:"Export CSV",exact:true}).waitFor();
    await choose(page,"Sort","Edge");
    await page.evaluate(()=>window.__toolsFixture.dropEcr());
    await page.waitForFunction(()=>window.__toolsFixture.boardReads===2);
    await page.getByText("120 players · no ECR cached",{exact:true}).waitFor();
    assert.equal(await page.getByRole("button",{name:"Sort: Pos rank",exact:true}).count(),1,"Unavailable Edge sort must fall back to the displayed valid sort");
    await page.locator(".bestball-pos-group").first().waitFor();
  });
  if(!regressionsOnly) {
    for(const width of [1280,390])for(const theme of ["light","dark"]) {
      for(const format of ["auction","snake"]) {
        const spec={page:"strategy",width,theme,format};
        await run(spec,async page=>{
          await page.locator(".hub-strategy-card").first().waitFor();
          const positions=await page.locator(".hub-strategy-card .hub-strategy-meta").allTextContents();
          assert.equal(positions.length,2);
          assert.equal(positions[0].split(" · ")[0],positions[1].split(" · ")[0],"Faceoffs compare the same position");
          if(format==="snake")assert.equal(await page.locator(".hub-strategy-card").filter({hasText:/\$/}).count(),0,"Pick drafts do not show auction prices");
          const checks=[await audit(page,spec,"faceoff-"+format)];
          const before=await page.locator(".hub-strategy-card").allTextContents();
          await page.locator("main").focus();await page.keyboard.press("ArrowRight");
          await page.getByRole("button",{name:"Undo",exact:true}).waitFor();
          assert.equal(await page.getByRole("button",{name:"Undo",exact:true}).isDisabled(),false);
          await page.getByRole("button",{name:"Undo",exact:true}).click();
          assert.deepEqual(await page.locator(".hub-strategy-card").allTextContents(),before);
          await page.getByRole("button",{name:"View my rankings",exact:true}).click();
          await page.evaluate(()=>{window.__toolsFixture.failQueue=true;});
          await page.getByRole("button",{name:"Use my rankings",exact:true}).click();
          await page.getByRole("alert").filter({hasText:"Synthetic queue save failed"}).waitFor();
          await page.evaluate(()=>{window.__toolsFixture.failQueue=false;});
          await page.getByRole("button",{name:"Use my rankings",exact:true}).click();
          await page.getByText("Your rankings are saved to the draft queue.",{exact:true}).waitFor();
          checks.push(await audit(page,spec,"rankings-"+format));return checks;
        });
      }
      const mock={page:"mock",width,theme,format:"snake"};
      await run(mock,async page=>{
        await page.getByText("Recent synthetic mock",{exact:true}).first().waitFor();
        assert.equal(await page.locator(".mock-draft-rail-recent li").count(),3);
        await page.locator(".mock-draft-advanced > summary").click();
        await page.locator("#mock-use-league-rules").check();
        assert.equal(await page.getByRole("button",{name:"10 teams",exact:true}).isDisabled(),true);
        await page.evaluate(()=>{window.__toolsFixture.failStart=true;});
        await page.getByRole("button",{name:"Enter the draft room",exact:true}).click();
        await page.getByRole("alert").filter({hasText:"Synthetic launch failed"}).waitFor();
        const start=await page.evaluate(()=>window.__toolsFixture.writes.find(write=>write.path.endsWith("mock-draft/start")).body);
        assert.equal(start.team_count,10);assert.equal(start.bot_count,9);assert.equal(start.source_league_id,"preview-a");
        assert.equal(await page.locator("#mock-use-league-rules").isChecked(),true);
        const checks=[await audit(page,mock,"launch")];
        await page.locator(".mock-draft-recent > summary").click();
        await page.evaluate(()=>{window.__toolsFixture.failKeep=true;});
        await page.getByRole("button",{name:"Unpin this mock",exact:true}).click();
        await page.getByRole("alert").filter({hasText:"Synthetic pin update failed"}).waitFor();
        assert.equal(await page.getByRole("button",{name:"Unpin this mock",exact:true}).getAttribute("aria-pressed"),"true");
        await page.evaluate(()=>{window.__toolsFixture.failKeep=false;});
        await page.getByRole("button",{name:"Unpin this mock",exact:true}).click();
        await page.waitForFunction(()=>window.__toolsFixture.rooms[0].saved===false);
        await page.locator(".mock-draft-rail-recent-link").first().click();
        await page.getByText("Mock draft done",{exact:true}).waitFor();
        await page.getByRole("button",{name:"Back to setup",exact:true}).click();
        await page.locator(".mock-draft-tool").waitFor();return checks;
      });
      const bb={page:"bestball",width,theme};
      await run(bb,async page=>{
        await page.getByText("120 players",{exact:true}).waitFor();
        const count=await page.locator(".bestball-table tbody tr:not([aria-hidden])").count();assert.ok(count<120,"Production table windows rows");
        const rows=await csv(page);assert.equal(rows.length,121);assert.deepEqual(rows[0],["#","Pos rank","Player","Pos","Team","Bye","Season proj","Pos ECR","Edge"]);
        assert.ok(rows.some(row=>row[2]==='Example, "quoted" receiver'));
        const checks=[await audit(page,bb,"board")];
        await choose(page,"ECR","No ECR");const missing=await csv(page);assert.equal(missing.length,31);assert.ok(missing.slice(1).every(row=>row[7]==="No ECR"));
        await page.getByRole("searchbox",{name:"Search best ball board",exact:true}).fill("Example QB 1");
        const filtered=await csv(page);assert.ok(filtered.slice(1).every(row=>row[2].includes("Example QB 1")));
        await page.evaluate(()=>{window.__toolsFixture.failBoard=true;window.__toolsFixture.refreshBoard();});
        await page.getByRole("alert").filter({hasText:"Synthetic board refresh failed"}).waitFor();
        assert.equal((await csv(page)).length,filtered.length,"Failed refresh retains filtered saved data");
        return checks;
      });
    }
    for(const width of [1280,390])for(const pageName of ["strategy","mock","bestball"])for(const state of ["empty","loading"]) {
      if(pageName==="mock"&&state==="loading")continue;
      const spec={page:pageName,width,theme:"light",state};
      await run(spec,async page=>{
        if(pageName==="bestball"&&state==="loading") {
          await page.getByLabel("Building the board",{exact:true}).waitFor();
          assert.equal(await page.getByRole("button",{name:"Export CSV",exact:true}).isDisabled(),true);
        } else if(pageName==="bestball")await page.getByText("No players match this filter.",{exact:true}).waitFor();
        else if(pageName==="mock")await page.getByText(mockDraftHeroCopy().recentEmpty,{exact:true}).waitFor();
        return [await audit(page,spec,state)];
      });
    }
    for(const width of [320,1024])for(const pageName of ["strategy","mock","bestball"])for(const theme of ["light","dark"]) {
      const spec={page:pageName,width,theme};
      await run(spec,async page=>{
        if(pageName==="bestball")await page.getByText("120 players",{exact:true}).waitFor();
        else if(pageName==="mock")await page.getByText("Recent synthetic mock",{exact:true}).first().waitFor();
        return [await audit(page,spec,"ready")];
      });
    }
  }
} finally {await fs.writeFile(path.join(output,"report.json"),JSON.stringify(report,null,2));await browser.close();}
if(report.cases.some(row=>!row.passed))process.exitCode=1;
