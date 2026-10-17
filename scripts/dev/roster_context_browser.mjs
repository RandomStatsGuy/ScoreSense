// Current Cap/Rosters/My team; scoped synthetic reads and queued roster writes.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import {attachDraftFixture} from "./draft_fixture_runtime.mjs";
import {measureScript,minTargetForWidth,NUMERIC_RE,BAR_CONTROL_SELECTOR,TABLE_DEAD_ZONE_PX,COLUMN_PACK_RATIO,GUTTER_EDGE_SELECTORS} from "./layout_audit.mjs";
import {MY_TEAM_COPY as M} from "../../frontend/src/DraftHub/rosterPresentation.js";
import {CAP_PLANNER_COPY as C} from "../../frontend/src/DraftHub/capPlannerPresentation.js";
import {ROSTERS_COPY as RC,ROSTER_BOARD_COPY as R} from "../../frontend/src/DraftHub/leagueRostersPresentation.js";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../.."),require=createRequire(path.join(root,"frontend/package.json"));
const {chromium}=require("playwright"),output=path.join(root,"outputs/roster-context-acceptance");await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,channel:process.platform==="win32"?"msedge":undefined});
const baseline=process.argv.includes("--baseline"),report={synthetic:true,productionComponents:true,cases:[]};
const matchIndex=process.argv.indexOf("--match"),match=matchIndex<0?null:new RegExp(process.argv[matchIndex+1]);
const frame=page=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
const noWrites=async page=>assert.equal(await page.evaluate(()=>window.__rosterFixture.writes.length),0);
async function manage(page){const tab=page.getByRole("button",{name:M.manage,exact:true});await (await tab.count()?tab:page.getByRole("button",{name:M.playerDetails,exact:true})).click();await page.locator('.my-team-player').first().waitFor();}
async function cut(page,surface){
  if(surface==="cap"){await page.locator('.cap-planner-player').filter({hasText:"A Josh Allen"}).click();await page.locator('.cap-planner-move .btn-primary').click();}
  else{await manage(page);await page.getByRole("button",{name:M.openPlayer("A Josh Allen",true),exact:true}).click();assert.equal(await page.getByRole("button",{name:M.dropLabel,exact:true}).count(),0,"Owners cannot use staff removal");await page.getByRole("dialog").getByRole("button",{name:M.cutLabel,exact:true}).click();}
  await page.getByRole("alertdialog").waitFor();
}
async function switchScope(page,league,team="mine"){await page.evaluate(({league,team})=>window.__rosterFixture.switchScope(league,team),{league,team});await frame(page);}
async function resolveWrite(page,ok=true,index=0){await page.evaluate(({ok,index})=>window.__rosterFixture.writes[index].resolve({ok}),{ok,index});await frame(page);}
async function inspect(page,spec,state){
  await page.evaluate(()=>scrollTo(0,0));
  const layout=await page.evaluate(measureScript(),{minTarget:minTargetForWidth(spec.width),numericRe:NUMERIC_RE.source,barControlSelector:BAR_CONTROL_SELECTOR,tableDeadZonePx:TABLE_DEAD_ZONE_PX,columnPackRatio:COLUMN_PACK_RATIO,gutterSelectors:GUTTER_EDGE_SELECTORS});
  await page.screenshot({path:path.join(output,`${spec.name}-${spec.width}-${spec.theme}-${state}.png`)});
  const lower=spec.width<=390?(spec.surface==="cap"?page.locator('.cap-planner-move'):spec.surface==="rosters"?page.locator('.rosters-detail'):null):null;
  if(lower&&await lower.count()){
    await lower.scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(output,`${spec.name}-${spec.width}-${spec.theme}-${state}-lower.png`)});
  }
  assert.deepEqual(layout.filter(row=>!row.ok),[],`${spec.name}/${state} layout`);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);return {state,layout};
}
async function run(spec,task){
  if(match&&!match.test(spec.name))return;
  const context=await browser.newContext({viewport:{width:spec.width,height:900},reducedMotion:"reduce",serviceWorkers:"block"}),errors=[],unexpected=[];
  await context.route("**/*",route=>{const url=new URL(route.request().url());if(!(url.hostname==="a.espncdn.com"&&url.pathname==="/combiner/i"&&/^\/i\/teamlogos\/nfl\/500\/[a-z]+\.png$/.test(url.searchParams.get("img")||"")))unexpected.push(url.href);return route.abort();});
  await context.addInitScript(theme=>localStorage.setItem("scoresense-color-theme",theme),spec.theme);await attachDraftFixture(context,{fixture:"roster-context"});
  const page=await context.newPage();page.setDefaultTimeout(7000);page.on("pageerror",e=>errors.push(e.message));
  try{
    await page.goto(`http://127.0.0.1:5173/hub/${spec.surface}?surface=${spec.surface}&${spec.query||""}`);
    await page.locator(spec.surface==="cap"?'.cap-planner-page,main h1':spec.surface==="rosters"?'.rosters-board':'.team-room').first().waitFor();
    const checks=await task(page);assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
    assert.deepEqual(await page.evaluate(()=>window.__rosterFixture.requests.filter(r=>!["GET","HEAD"].includes(r.method)&&!((["PATCH","DELETE"].includes(r.method)&&r.url==="/api/hub/roster")||(r.method==="POST"&&r.url==="/api/hub/contract/rookie-extend")))),[],"No focus, lineup, trade, import or unrelated writes");
    report.cases.push({...spec,passed:true,checks});console.log("PASS",spec.name,spec.width,spec.theme);
  }catch(error){await page.screenshot({path:path.join(output,`failure-${spec.name}-${spec.width}-${spec.theme}.png`)});await fs.writeFile(path.join(output,`failure-${spec.name}-${spec.width}-${spec.theme}.txt`),error.stack+"\n"+await page.locator("body").innerText());report.cases.push({...spec,passed:false,error:error.message});console.log("FAIL",spec.name,spec.width,spec.theme,error.message);}
  finally{await context.close();}
}
try{
  for(const width of (baseline?[1280]:[1280,390]))for(const theme of (baseline?["dark"]:["light","dark"]))for(const surface of ["cap","team"]){
    await run({name:`${surface}-stale-confirm`,surface,width,theme},async page=>{
      await cut(page,surface);await switchScope(page,"B");await page.getByRole("alertdialog").locator('.btn-danger').click();await frame(page);
      await noWrites(page);return baseline?[]:[await inspect(page,{name:`${surface}-stale-confirm`,width,theme},"cancelled")];
    });
  }
  for(const width of (baseline?[1280]:[1280,390]))for(const theme of (baseline?["dark"]:["light","dark"])){
    const spec={name:"team-readonly",surface:"team",query:"readonly=1&staff=1",width,theme};
    await run(spec,async page=>{await manage(page);assert.equal(await page.getByRole("button",{name:new RegExp("^"+M.appearance)}).count(),0,"Read-only context cannot expose team appearance writes");await page.getByRole("button",{name:M.openPlayer("A Josh Allen",true),exact:true}).click();
      assert.equal(await page.getByRole("button",{name:M.cutLabel,exact:true}).count(),0,"Read-only context cannot expose Cut");
      assert.equal(await page.getByRole("button",{name:M.dropLabel,exact:true}).count(),0,"Read-only context cannot expose staff removal");
      await noWrites(page);return baseline?[]:[await inspect(page,spec,"details")];
    });
  }
  if(!baseline)for(const width of [1280,390])for(const theme of ["light","dark"])for(const surface of ["cap","team"]){
    const spec={name:`${surface}-extension-late`,surface,width,theme,query:"pre=1"};
    await run(spec,async page=>{
      if(surface==="cap"){
        await page.locator('.cap-planner-row').filter({hasText:"A DeVonta Smith"}).getByRole("button",{name:"Extend +",exact:true}).click();
        await page.getByRole("group",{name:"A DeVonta Smith extension years",exact:true}).getByRole("button",{name:"+2 yrs",exact:true}).click();
        await page.locator('.cap-planner-main > details > summary').click();await page.getByRole("button",{name:C.saveExtension,exact:true}).click();
      }else{
        await manage(page);await page.getByRole("button",{name:M.openPlayer("A DeVonta Smith",true),exact:true}).click();
        await page.getByRole("button",{name:"Queue extension",exact:true}).click();
      }
      await page.waitForFunction(()=>window.__rosterFixture.writes.length===1);
      assert.equal(await page.evaluate(()=>window.__rosterFixture.writes[0].url),"/api/hub/contract/rookie-extend");
      assert.equal(await page.evaluate(()=>window.__rosterFixture.writes[0].body.extension_years),2);
      await switchScope(page,"B");await resolveWrite(page,true);
      assert.equal(await page.evaluate(()=>window.__rosterFixture.callbacks.length),0,"Old extension completion cannot refresh another context");
      if(surface==="team"){
        await manage(page);await page.getByRole("button",{name:M.openPlayer("B DeVonta Smith",true),exact:true}).click();
        assert.equal(await page.getByRole("button",{name:"Queue extension",exact:true}).isEnabled(),true);
        await page.evaluate(()=>window.__rosterFixture.setReadonly(true));await frame(page);
        assert.equal(await page.getByRole("button",{name:"Queue extension",exact:true}).count(),0);
      }
      return [await inspect(page,spec,"retained")];
    });
  }
  if(!baseline)for(const width of [1280,390])for(const theme of ["light","dark"])for(const surface of ["cap","team"])for(const ok of [true,false]){
    const spec={name:`${surface}-late-${ok?"success":"error"}`,surface,width,theme};
    await run(spec,async page=>{await cut(page,surface);await page.getByRole("alertdialog").locator('.btn-danger').click();await page.waitForFunction(()=>window.__rosterFixture.writes.length===1);
      assert.equal(await page.evaluate(()=>window.__rosterFixture.writes[0].league),"A");await switchScope(page,"B");await resolveWrite(page,ok);
      if(surface==="team")await manage(page);
      assert.equal(await page.evaluate(()=>window.__rosterFixture.callbacks.length),0,"Old completion cannot refresh the new context");
      assert.equal(await page.evaluate(()=>window.__rosterFixture.navigations.length),0,"Old completion cannot navigate the new context");
      assert.doesNotMatch(await page.locator('body').innerText(),/Synthetic roster save failed/);return [await inspect(page,spec,"retained")];
    });
  }
  if(!baseline)for(const width of [1280,390])for(const theme of ["light","dark"])for(const surface of ["cap","team"])for(const ok of [true,false]){
    const spec={name:`${surface}-permission-recovery-${ok?"success":"error"}`,surface,width,theme};
    await run(spec,async page=>{
      await cut(page,surface);await page.getByRole("alertdialog").locator('.btn-danger').click();await page.waitForFunction(()=>window.__rosterFixture.writes.length===1);
      await page.evaluate(()=>window.__rosterFixture.setReadonly(true));await frame(page);await resolveWrite(page,ok);
      await page.evaluate(()=>window.__rosterFixture.setReadonly(false));await frame(page);
      const action=surface==="cap"?page.locator('.cap-planner-move .btn-primary'):page.getByRole("dialog").getByRole("button",{name:M.cutLabel,exact:true});
      assert.equal(await action.isEnabled(),true,"Restored permission cannot retain an invalidated action's busy state");
      assert.equal(await page.evaluate(()=>window.__rosterFixture.callbacks.length),0);
      assert.equal(await page.evaluate(()=>window.__rosterFixture.navigations.length),0);
      assert.doesNotMatch(await page.locator('body').innerText(),/Synthetic roster save failed/);
      return [await inspect(page,spec,"ready")];
    });
  }
  if(!baseline)for(const width of [1280,390])for(const theme of ["light","dark"])for(const surface of ["cap","team"])for(const change of ["team","round-trip","permission"]){
    const spec={name:`${surface}-confirm-${change}`,surface,width,theme};
    await run(spec,async page=>{await cut(page,surface);
      if(change==="team")await switchScope(page,"A","other");
      else if(change==="round-trip"){await switchScope(page,"B");await switchScope(page,"A");}
      else{await page.evaluate(()=>window.__rosterFixture.setReadonly(true));await frame(page);}
      await page.getByRole("alertdialog").locator('.btn-danger').click();await frame(page);await noWrites(page);
      return [await inspect(page,spec,"cancelled")];
    });
  }
  if(!baseline)for(const width of [1280,1024,390,320])for(const theme of ["light","dark"]){
    const spec={name:"cap-planning",surface:"cap",width,theme};
    await run(spec,async page=>{
      assert.equal(await page.locator('.cap-planner-balance > strong').innerText(),"$48");
      await page.getByRole("group",{name:"Cap season",exact:true}).getByRole("button",{name:"2027",exact:true}).click();
      await page.locator('.cap-planner-row').filter({hasText:"A Josh Allen"}).getByRole("button",{name:"Extend +",exact:true}).click();
      await page.getByRole("group",{name:"A Josh Allen extension years",exact:true}).getByRole("button",{name:"+2 yrs",exact:true}).click();
      await page.getByRole("button",{name:C.previewYears(2),exact:true}).waitFor();
      await page.getByRole("group",{name:"Cap season",exact:true}).getByRole("button",{name:"2028",exact:true}).click();
      await page.getByRole("textbox",{name:C.target,exact:true}).fill("20");
      const checks=[await inspect(page,spec,"own-preview")];await noWrites(page);
      await page.getByRole("button",{name:C.around+" ↗",exact:true}).click();await page.locator('.cap-planner-team').first().waitFor();
      await page.getByRole("button",{name:/^A Rivals,/}).click();
      assert.equal(await page.locator('.cap-planner-balance > strong').innerText(),"$108");
      assert.equal(await page.getByRole("textbox",{name:C.target,exact:true}).inputValue(),"");
      await page.locator('.cap-planner-player').first().click();
      assert.equal(await page.locator('.cap-planner-move .btn-primary').count(),0,"Other-team planning never offers a roster write");
      await page.locator('.cap-planner-main > details > summary').click();
      assert.equal(await page.getByRole("button",{name:C.saveExtension,exact:true}).count(),0);
      checks.push(await inspect(page,spec,"other-preview"));await noWrites(page);
      await page.getByRole("button",{name:C.myCap+" →",exact:true}).click();
      await page.getByRole("button",{name:C.previewYears(2),exact:true}).waitFor();
      await page.getByRole("button",{name:C.reset,exact:true}).click();assert.equal(await page.getByRole("button",{name:C.previewYears(2),exact:true}).count(),0);
      assert.equal(await page.locator('.cap-planner-balance > strong').innerText(),"$48");await noWrites(page);return checks;
    });
  }
  if(!baseline)for(const width of [1280,390])for(const theme of ["light","dark"]){
    const spec={name:"rosters-browsing",surface:"rosters",width,theme};
    await run(spec,async page=>{
      await page.locator('.rosters-player').first().waitFor();
      assert.equal(await page.locator('.rosters-detail').count(),0,"Nothing is selected implicitly");
      await page.getByRole("tab",{name:"Team rosters",exact:true}).click();
      await page.getByRole("button",{name:R.openTeam("A Owners"),exact:true}).click();
      const first=page.getByRole("button",{name:R.playerDetails("A Josh Allen"),exact:true});await first.waitFor();
      assert.equal(await page.locator('tbody tr:not(.rosters-inline-detail)').count(),6,"Team roster retains the player with no estimate");
      assert.match(await page.locator('.rosters-cap-summary').innerText(),/\$48/);
      const checks=[await inspect(page,spec,"full-team")];await first.click();await page.locator('.rosters-detail').waitFor();
      assert.match(await page.locator('.rosters-detail-values').innerText(),/—/);checks.push(await inspect(page,spec,"missing-estimate"));
      await page.locator('.rosters-detail').press("Escape");assert.equal(await first.evaluate(el=>el===document.activeElement),true);
      await page.evaluate(()=>window.__rosterFixture.failReads=true);await page.getByRole("button",{name:RC.refreshLeague,exact:true}).click();
      await page.locator('.rosters-error').waitFor();assert.equal(await page.locator('tbody tr:not(.rosters-inline-detail)').count(),6,"Failed refresh retains the last good roster");
      checks.push(await inspect(page,spec,"refresh-error"));await page.evaluate(()=>window.__rosterFixture.failReads=false);
      await page.getByRole("button",{name:RC.refreshLeague,exact:true}).click();await page.locator('.rosters-error').waitFor({state:"hidden"});
      await page.getByRole("textbox",{name:R.search,exact:true}).fill("Charbonnet");
      await switchScope(page,"B");await page.getByRole("button",{name:R.playerDetails("B Zach Charbonnet"),exact:true}).waitFor();
      assert.equal(await page.getByRole("textbox",{name:R.search,exact:true}).inputValue(),"");
      await switchScope(page,"A");await page.getByRole("button",{name:R.playerDetails("A Zach Charbonnet"),exact:true}).waitFor();
      assert.equal(await page.getByRole("textbox",{name:R.search,exact:true}).inputValue(),"Charbonnet","Browsing preferences return only for their league");
      await noWrites(page);return checks;
    });
  }
  if(!baseline)for(const width of [1280,390])for(const theme of ["light","dark"]){
    const spec={name:"rosters-stale-read",surface:"rosters",width,theme};
    await run(spec,async page=>{
      await page.getByRole("button",{name:R.playerDetails("A Zach Charbonnet"),exact:true}).waitFor();await page.evaluate(()=>window.__rosterFixture.delayReads=true);
      await page.getByRole("button",{name:RC.refreshLeague,exact:true}).click();await page.waitForFunction(()=>window.__rosterFixture.reads.some(r=>r.id==="A"));
      await switchScope(page,"B");await page.waitForFunction(()=>window.__rosterFixture.reads.some(r=>r.id==="B"));
      await page.evaluate(()=>window.__rosterFixture.reads.find(r=>r.id==="B").resolve());await page.getByRole("button",{name:R.playerDetails("B Zach Charbonnet"),exact:true}).waitFor();
      await page.evaluate(()=>window.__rosterFixture.reads.find(r=>r.id==="A").resolve());await frame(page);
      assert.equal(await page.getByRole("button",{name:R.playerDetails("A Zach Charbonnet"),exact:true}).count(),0);await noWrites(page);return [await inspect(page,spec,"current")];
    });
  }
  if(!baseline)for(const width of [1280,390])for(const theme of ["light","dark"])for(const format of ["snake","linear"])for(const surface of ["cap","rosters","team"]){
    const spec={name:`${surface}-${format}`,surface,width,theme,query:`format=${format}`};
    await run(spec,async page=>{
      if(surface==="cap"){assert.equal(await page.locator('.cap-planner-balance').count(),0);await noWrites(page);return [await inspect(page,spec,"unavailable")];}
      if(surface==="rosters"){
        await page.getByRole("button",{name:R.openTeam("A Owners"),exact:true}).click();
        await page.getByRole("button",{name:R.playerDetails("A Josh Allen"),exact:true}).click();
        assert.equal(await page.locator('tbody tr:not(.rosters-inline-detail)').count(),6);
        assert.equal(await page.getByRole("button",{name:R.history,exact:true}).count(),0);
      }else{await manage(page);await page.getByRole("button",{name:M.openPlayer("A Josh Allen",false),exact:true}).click();}
      assert.doesNotMatch(await page.locator('body').innerText(),/\$|\bsalary|\bdead cap|\bcontract|\byears left/i);
      await noWrites(page);return [await inspect(page,spec,"details")];
    });
  }
  if(!baseline)for(const width of [1280,390])for(const theme of ["light","dark"])for(const host of ["native","sleeper"]){
    const spec={name:`room-${host}`,surface:"team",width,theme,query:`host=${host}`};
    await run(spec,async page=>{
      const total=page.locator('.team-room-total-number > strong');await total.waitFor();assert.equal(await total.innerText(),"35.0");
      await page.getByRole("button",{name:M.roomDragPlayer("A Zach Charbonnet"),exact:true}).click();
      await page.getByRole("button",{name:M.roomPreviewSwap,exact:true}).click();
      assert.equal(await total.innerText(),"50.0");await page.getByText(M.roomPreviewOnly,{exact:true}).waitFor();await noWrites(page);
      const checks=[await inspect(page,spec,"preview")];await page.getByRole("button",{name:M.roomResetPreview,exact:true}).click();assert.equal(await total.innerText(),"35.0");
      await page.getByRole("button",{name:/^Visit team/}).click();await page.getByRole("option",{name:"A manager 2 · A Rivals",exact:true}).click();
      await page.getByRole("heading",{name:"A Rivals",exact:true}).waitFor();assert.equal(await page.getByRole("button",{name:M.roomPreviewSwap,exact:true}).count(),0);
      assert.equal(await page.getByRole("button",{name:M.shareRoom,exact:true}).count(),0);checks.push(await inspect(page,spec,"visitor"));await noWrites(page);return checks;
    });
  }
  if(!baseline)for(const width of [1280,390])for(const theme of ["light","dark"]){
    const spec={name:"room-missing-locked",surface:"team",width,theme,query:"missing=1&locked=1"};
    await run(spec,async page=>{await page.locator('.team-room-total-number > strong').waitFor();assert.equal(await page.locator('.team-room-total-number > strong').innerText(),"—");
      await page.getByRole("button",{name:M.roomDragPlayer("A Zach Charbonnet"),exact:true}).click();
      const button=page.getByRole("button",{name:M.roomPreviewSwap,exact:true});assert.equal(await button.count()===0||await button.isDisabled(),true);await noWrites(page);return [await inspect(page,spec,"blocked")];
    });
  }
  if(!baseline)for(const width of [1280,390])for(const theme of ["light","dark"])for(const surface of ["cap","team"]){
    const spec={name:`${surface}-failed-cut`,surface,width,theme};
    await run(spec,async page=>{await cut(page,surface);await page.getByRole("alertdialog").locator('.btn-danger').click();await page.waitForFunction(()=>window.__rosterFixture.writes.length===1);await resolveWrite(page,false);
      await (surface==="team"?page.getByRole("dialog"):page).getByText("Synthetic roster save failed",{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.__rosterFixture.callbacks.length),0);
      const checks=[await inspect(page,spec,"retained")];
      if(surface==="cap")await page.locator('.cap-planner-move .btn-primary').click();else await page.getByRole("dialog").getByRole("button",{name:M.cutLabel,exact:true}).click();
      await page.getByRole("alertdialog").locator('.btn-danger').click();await page.waitForFunction(()=>window.__rosterFixture.writes.length===2);await resolveWrite(page,true,1);
      assert.equal(await page.evaluate(()=>window.__rosterFixture.callbacks.length),1);return checks;
    });
  }
  if(!baseline)for(const width of [1280,390])for(const theme of ["light","dark"])for(const format of ["auction","snake"]){
    const spec={name:`team-staff-${format}`,surface:"team",width,theme,query:`staff=1&format=${format}`};
    await run(spec,async page=>{
      const removeLabel=format==="auction"?M.dropLabel:M.dropPlayer;
      const open=async league=>{await manage(page);await page.getByRole("button",{name:M.openPlayer(`${league} Josh Allen`,format==="auction"),exact:true}).click();await page.getByRole("dialog").getByRole("button",{name:removeLabel,exact:true}).click();await page.getByRole("alertdialog").waitFor();};
      await open("A");await switchScope(page,"B");await page.getByRole("alertdialog").locator('.btn-danger').click();await frame(page);await noWrites(page);
      await open("B");await page.getByRole("alertdialog").locator('.btn-danger').click();await page.waitForFunction(()=>window.__rosterFixture.writes.length===1);
      assert.equal(await page.evaluate(()=>window.__rosterFixture.writes[0].method),"DELETE");
      assert.equal(await page.evaluate(()=>window.__rosterFixture.writes[0].body.roster_slot_id),201);
      await switchScope(page,"A");await resolveWrite(page,true);assert.equal(await page.evaluate(()=>window.__rosterFixture.callbacks.length),0);
      await open("A");const checks=[await inspect(page,spec,"confirmation")];
      await page.getByRole("alertdialog").locator('.btn-danger').click();await page.waitForFunction(()=>window.__rosterFixture.writes.length===2);await resolveWrite(page,true,1);
      assert.deepEqual(await page.evaluate(()=>window.__rosterFixture.callbacks),[{league:"A",team:"mine"}]);return checks;
    });
  }
}finally{await fs.writeFile(path.join(output,baseline?"before-report.json":match?"focused-report.json":"report.json"),JSON.stringify(report,null,2));await browser.close();}
if(report.cases.some(row=>!row.passed))process.exitCode=1;
