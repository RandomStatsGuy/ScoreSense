// Production lobby/live/practice components; HTTP and WebSockets are synthetic.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { attachDraftFixture, draftFixtureUrl } from "./draft_fixture_runtime.mjs";
import { measureScript, minTargetForWidth, NUMERIC_RE, BAR_CONTROL_SELECTOR,
  TABLE_DEAD_ZONE_PX, COLUMN_PACK_RATIO, GUTTER_EDGE_SELECTORS } from "./layout_audit.mjs";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const require=createRequire(path.join(root,"frontend/package.json")), {chromium}=require("playwright");
const output=path.join(root,"outputs/draft-flow-review");
await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,channel:process.platform==="win32"?"msedge":undefined});
const report={synthetic:true,productionComponents:true,cases:[]};
const onlyRace=process.argv.includes("--race-only"),onlyPick=process.argv.includes("--pick-only");
async function setup({width=1280,theme="dark",state="bidding",practice=false,format="auction",role="commissioner",offline=false}={}) {
  const context=await browser.newContext({viewport:{width,height:960},reducedMotion:"reduce",colorScheme:theme,serviceWorkers:"block"});
  const errors=[],blocked=[],mediaFallbacks=[];
  await context.route("**/*",route=>{
    const url=new URL(route.request().url());
    if(url.hostname==="a.espncdn.com"&&url.pathname==="/combiner/i"&&/^\/i\/teamlogos\/nfl\/500\/[a-z]+\.png$/.test(url.searchParams.get("img")||""))
      mediaFallbacks.push(url.href);
    else blocked.push(url.href);
    return route.abort();
  });
  await context.addInitScript(theme=>{localStorage.setItem("scoresense-color-theme",theme);localStorage.setItem("scoresense:draft-sound","0");},theme);
  await attachDraftFixture(context);
  const page=await context.newPage();page.setDefaultTimeout(10000);
  page.on("pageerror",error=>errors.push(error.message));
  await page.clock.install({time:new Date("2026-10-17T12:00:00Z")});
  await page.goto(`${draftFixtureUrl}?${new URLSearchParams({state,practice:practice?"1":"0",format,role,offline:offline?"1":"0"})}`);
  try { await page.locator(".hub-draft-room").waitFor(); } catch (error) {
    await fs.writeFile(path.join(output,"setup-failure.txt"),JSON.stringify({errors,blocked,body:await page.locator("body").innerText()},null,2));
    throw error;
  }
  await page.waitForFunction(()=>window.__draftFixture.reads.includes("/api/hub/league/sample"));
  await page.locator(".hub-draft-live-command, .hub-draft-entry, .hub-draft-ended").first().waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),theme);
  return {context,page,errors,blocked,mediaFallbacks};
}
async function audit(page,spec,state) {
  const layout=await page.evaluate(measureScript(),{minTarget:minTargetForWidth(spec.width),numericRe:NUMERIC_RE.source,
    barControlSelector:BAR_CONTROL_SELECTOR,tableDeadZonePx:TABLE_DEAD_ZONE_PX,columnPackRatio:COLUMN_PACK_RATIO,gutterSelectors:GUTTER_EDGE_SELECTORS});
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
  const name=`${spec.practice?"practice":"native"}-${spec.format||"auction"}-${spec.role||"commissioner"}-${spec.offline?"offline-":""}${state}-${spec.width}-${spec.theme}`;
  await page.evaluate(()=>scrollTo(0,0));
  await page.screenshot({path:path.join(output,name+".png"),fullPage:true});
  await page.screenshot({path:path.join(output,name+"-top.png")});
  await fs.writeFile(path.join(output,name+".json"),JSON.stringify({layout,overflow},null,2));
  assert.equal(overflow,false,`${name} horizontal overflow`);
  assert.deepEqual(layout.filter(row=>!row.ok),[],`${name} layout`);
  return {state,layout,overflow};
}
async function rejectedBid(page,transition="bid") {
  await page.getByLabel("Bid amount",{exact:true}).fill("15");
  await page.evaluate(()=>{window.__draftFixture.delayBid=true;window.__draftFixture.failBid=true;});
  await page.getByRole("button",{name:"Bid $15",exact:true}).click();
  await page.waitForFunction(()=>typeof window.__draftFixture.releaseBid==="function");
  await page.evaluate(transition=>{const f=window.__draftFixture;if(transition==="bid")f.publishBid(20);else if(transition==="nomination")f.publishNomination();},transition);
  if(transition==="bid")await page.getByText("Current $20",{exact:true}).waitFor();
  else if(transition==="nomination")await page.getByLabel("Bid amount",{exact:true}).waitFor({state:"detached"});
  await page.evaluate(()=>window.__draftFixture.releaseBid());
  await page.getByText("Synthetic bid rejected. Check the current bid.",{exact:true}).waitFor();
  if(transition==="bid") {
    assert.equal(await page.getByText("Current $20",{exact:true}).count(),1,"Rejected bid must preserve the newer server bid");
    assert.equal(await page.getByLabel("Bid amount",{exact:true}).inputValue(),"21","Newer server bid updates the minimum suggestion");
  } else if(transition==="nomination")assert.equal(await page.getByLabel("Bid amount",{exact:true}).count(),0,"Rejected bid must preserve the newer nomination phase");
  else await page.getByText("Current $14",{exact:true}).waitFor();
}
async function run(spec,task) {
  if(onlyPick&&spec.format!=="snake")return;
  const {context,page,errors,blocked,mediaFallbacks}=await setup(spec);
  try {
    const checks=await task(page);
    assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);
    report.cases.push({...spec,passed:true,checks,mediaFallbacks});
    console.log(`PASS ${spec.state} ${spec.practice?"practice":"native"} ${spec.width}/${spec.theme}`);
  } catch(error) {
    report.cases.push({...spec,passed:false,error:error.message});
    await fs.writeFile(path.join(output,"failure.txt"),`${error.stack}\n${await page.locator("body").innerText()}`);
    await page.screenshot({path:path.join(output,"failure.png"),fullPage:true});
    throw error;
  } finally {await context.close();}
}
try {
  for(const transition of ["none","bid","nomination"])await run({width:390,theme:"dark",state:"bidding"},async page=>{
    await rejectedBid(page,transition);return {race:transition};
  });
  if(!onlyRace) {
    for(const width of [1280,390])for(const theme of ["light","dark"])for(const practice of [false,true]) {
      const spec={width,theme,practice,state:"bidding"};
      await run(spec,async page=>{
        await rejectedBid(page);
        await page.evaluate(()=>{window.__draftFixture.delayBid=false;window.__draftFixture.failBid=false;});
        await page.getByLabel("Bid amount",{exact:true}).fill("21");
        await page.getByRole("button",{name:"Bid $21",exact:true}).click();
        await page.getByText("Current $21",{exact:true}).waitFor();
        const card=page.locator(".hub-draft-player-card").filter({hasText:"Jahmyr Gibbs"}).first();
        await card.getByRole("button",{name:"Queue",exact:true}).click();
        await page.waitForFunction(()=>window.__draftFixture.room.viewer.nomination_queue.includes("sample-gibbs"));
        await page.evaluate(()=>window.__draftFixture.publishBid(22));
        await page.getByText("Current $22",{exact:true}).waitFor();
        await page.getByRole("tab",{name:"Queue (1)",exact:true}).waitFor();
        await page.getByRole("button",{name:"Pause",exact:true}).click();
        await page.getByRole("button",{name:"Resume",exact:true}).waitFor();
        assert.equal(await page.getByLabel("Bid amount",{exact:true}).count(),0);
        await page.getByRole("button",{name:"Resume",exact:true}).click();
        await page.getByText("Current $22",{exact:true}).waitFor();
        const checks=[await audit(page,spec,"bidding")];
        if(practice) {
          assert.equal(await page.getByRole("button",{name:/^Drop(?: |$)|^Trade(?: |$)/}).count(),0);
          const simulate=page.getByRole("button",{name:"Simulate",exact:true});
          await simulate.click();await page.getByRole("alertdialog").waitFor();
          await page.keyboard.press("Escape");await page.getByRole("alertdialog").waitFor({state:"detached"});
          await page.waitForFunction(()=>document.activeElement?.textContent.trim()==="Simulate",null,{timeout:2000});
          await simulate.click();
          await page.getByRole("alertdialog").getByRole("button",{name:"Simulate",exact:true}).click();
          await page.waitForFunction(()=>typeof window.__draftFixture.releaseSimulation==="function");
          await page.locator(".hub-draft-simulation-banner").waitFor();
          const more=page.getByRole("button",{name:"More commissioner controls",exact:true});
          await more.focus();await page.keyboard.press("Enter");await page.getByRole("menu").waitFor();
          await page.getByRole("menuitem",{name:"Discard mock",exact:true}).focus();
          await page.keyboard.press("Escape");await page.getByRole("menu").waitFor({state:"detached"});
          assert.equal(await more.evaluate(node=>node===document.activeElement),true,"Commissioner menu returns focus");
          await more.click();
          const discard=page.getByRole("menuitem",{name:"Discard mock",exact:true});
          assert.equal(await discard.isDisabled(),false,"Discard stays usable while simulation is running");
          await discard.click();
          await page.getByRole("alertdialog").getByRole("button",{name:"Delete sandbox",exact:true}).click();
          await page.getByText("Practice room discarded.",{exact:true}).waitFor();
          await page.evaluate(()=>window.__draftFixture.releaseSimulation());
          await page.clock.runFor(100);
          assert.equal(await page.locator(".hub-draft-room").count(),0,"Late simulation response cannot reopen the discarded room");
          assert.equal(await page.evaluate(()=>window.__draftFixture.changedLeague),"");
        } else {
          await page.evaluate(()=>window.__draftFixture.publishNomination("sample-0"));
          await card.getByRole("button",{name:"Nominate",exact:true}).click();
          await page.waitForFunction(()=>window.__draftFixture.room.session.current_nominee?.player_id==="sample-gibbs");
          await page.getByText("Current $1",{exact:true}).waitFor();
        }
        assert.equal(await page.evaluate(()=>window.__draftFixture.writes.some(write=>write.path.includes("/focus"))),false);
        return checks;
      });
    }
    for(const width of [1280,390])for(const theme of ["light","dark"])for(const state of ["nominating","paused","completed","setup","locked","closed"]) {
      const spec={width,theme,state,practice:false};
      await run(spec,async page=>{
        if(state==="paused") {
          const nominate=page.getByRole("button",{name:"Nominate",exact:true});
          assert.ok(await nominate.count()>0);assert.equal(await nominate.first().isDisabled(),true);
        } else if(state==="completed") await page.locator(".hub-recap-grade--auction").waitFor();
        else if(state==="setup") {
          const hour=page.locator(".draft-availability-hour").first();await hour.waitFor();
          await hour.focus();await page.keyboard.press("Enter");
          await page.evaluate(()=>{window.__draftFixture.failAvailability=true;});
          await page.getByRole("button",{name:"Save times",exact:true}).click();
          await page.getByRole("alert").filter({hasText:"Synthetic availability save failed"}).waitFor();
          assert.equal(await hour.getAttribute("aria-pressed"),"true","Failed save retains selected availability");
          await page.evaluate(()=>{window.__draftFixture.failAvailability=false;});
          await page.getByRole("button",{name:"Save times",exact:true}).click();
          await page.getByText("Times saved",{exact:true}).waitFor();
        } else if(state==="locked") await page.getByRole("heading",{name:"Room is full. Draft night is locked.",exact:true}).waitFor();
        else if(state==="closed") await page.getByText("Closed",{exact:true}).first().waitFor();
        return [await audit(page,spec,state)];
      });
    }
    for(const width of [1280,390])for(const theme of ["light","dark"]) {
      const completed={width,theme,state:"completed",practice:true};
      await run(completed,async page=>{
        await page.getByText("Mock draft done",{exact:true}).waitFor();
        await page.locator(".hub-recap-grade--auction").waitFor();
        return [await audit(page,completed,"completed")];
      });
      const pick={width,theme,state:"nominating",format:"snake"};
      await run(pick,async page=>{
        await page.getByRole("region",{name:"Live pick command bar",exact:true}).waitFor();
        assert.doesNotMatch(await page.locator(".hub-draft-room").innerText(),/\$|salary|leftover|dead cap/i,"Pick drafts hide legacy money fields");
        const card=page.locator(".hub-draft-player-card").filter({hasText:"Josh Allen"}).first();
        await card.getByRole("button",{name:"Pick",exact:true}).click();
        await page.waitForFunction(()=>window.__draftFixture.room.rosters["sample-0"].length===1);
        const full=page.getByRole("button",{name:"Full board",exact:true});
        await full.focus();await page.keyboard.press("Enter");
        const dialog=page.getByRole("dialog",{name:"Full snake draft board",exact:true});await dialog.waitFor();
        await page.waitForFunction(()=>document.querySelector('[role="dialog"]')?.contains(document.activeElement),null,{timeout:2000});
        for(let i=0;i<6;i++) {await page.keyboard.press("Tab");assert.equal(await dialog.evaluate(node=>node.contains(document.activeElement)),true);}
        assert.equal(await page.locator("#root").evaluate(node=>node.inert),true,"Background stays inert while the full board is open");
        const box=await dialog.boundingBox();assert.ok(box.x>=-1&&box.x+box.width<=width+1,"Full board fits the viewport");
        await page.screenshot({path:path.join(output,`full-board-${width}-${theme}.png`)});
        await page.keyboard.press("Escape");await dialog.waitFor({state:"detached"});
        assert.equal(await full.evaluate(node=>node===document.activeElement),true,"Board returns focus to its trigger");
        const checks=[await audit(page,pick,"after-pick")];
        await page.evaluate(()=>window.__draftFixture.publishRivalRoster());
        await page.getByRole("tab",{name:"Teams",exact:true}).click();
        const rival=page.locator(".hub-teams-dock .hub-team-card").nth(2);
        await rival.locator(".hub-team-card-toggle").focus();await page.keyboard.press("Enter");
        await page.getByText("Example receiver with a very long surname",{exact:true}).waitFor();
        checks.push(await audit(page,pick,"team-rosters"));
        return checks;
      });
    }
    for(const width of [1280,390]) {
      const visitor={width,theme:"light",state:"bidding",role:"visitor"};
      await run(visitor,async page=>{
        await page.getByLabel("Bid amount",{exact:true}).fill("15");
        await page.getByRole("button",{name:"Bid $15",exact:true}).click();
        await page.getByText("Join this draft room with your team to place bids.",{exact:true}).waitFor();
        assert.equal(await page.evaluate(()=>window.__draftFixture.writes.some(write=>write.path.endsWith("/bid"))),false);
        return [await audit(page,visitor,"visitor")];
      });
      const offline={width,theme:"light",state:"nominating",offline:true};
      await run(offline,async page=>{
        assert.equal(await page.getByLabel("Bid amount",{exact:true}).count(),0);
        assert.equal(await page.locator(".hub-draft-live-command-clock").count(),0);
        assert.equal(await page.getByRole("button",{name:"Nominate",exact:true}).count(),0);
        assert.ok(await page.getByRole("button",{name:"Record",exact:true}).count()>0);
        return [await audit(page,offline,"offline")];
      });
    }
    for(const width of [320,1024])for(const theme of ["light","dark"])for(const format of ["auction","snake"]) {
      const spec={width,theme,format,state:format==="snake"?"nominating":"bidding"};
      await run(spec,async page=>[await audit(page,spec,spec.state)]);
    }
  }
} finally {await fs.writeFile(path.join(output,"report.json"),JSON.stringify(report,null,2));await browser.close();}
console.log("PASS: current draft-room tasks and named layouts; synthetic state only.");
