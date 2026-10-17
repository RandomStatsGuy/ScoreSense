// Production management/acquisition components with isolated, queued HTTP fixtures.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import {attachDraftFixture} from "./draft_fixture_runtime.mjs";
import {measureScript,minTargetForWidth,NUMERIC_RE,BAR_CONTROL_SELECTOR,TABLE_DEAD_ZONE_PX,COLUMN_PACK_RATIO,GUTTER_EDGE_SELECTORS} from "./layout_audit.mjs";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../.."),require=createRequire(path.join(root,"frontend/package.json"));
const {chromium}=require("playwright"),output=path.join(root,"outputs/management-acquisition-acceptance");await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,channel:process.platform==="win32"?"msedge":undefined});
const baseline=process.argv.includes("--baseline"),matchArg=process.argv.indexOf("--match"),match=matchArg<0?null:new RegExp(process.argv[matchArg+1]),report={synthetic:true,productionComponents:true,cases:[]};
const frame=page=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
async function scope(page,id,team="mine"){await page.evaluate(({id,team})=>window.__management.switch(id,team),{id,team});await frame(page);}
async function resolve(page,ok=true,index=0){await page.evaluate(({ok,index})=>window.__management.writes[index].resolve({ok}),{ok,index});await frame(page);}
const noWrites=async page=>assert.equal(await page.evaluate(()=>window.__management.writes.length),0);
async function inspect(page,spec,state){
  const layout=await page.evaluate(measureScript(),{minTarget:minTargetForWidth(spec.width),numericRe:NUMERIC_RE.source,barControlSelector:BAR_CONTROL_SELECTOR,tableDeadZonePx:TABLE_DEAD_ZONE_PX,columnPackRatio:COLUMN_PACK_RATIO,gutterSelectors:GUTTER_EDGE_SELECTORS});
  await page.screenshot({path:path.join(output,`${spec.name}-${spec.width}-${spec.theme}-${state}.png`)});
  assert.deepEqual(layout.filter(r=>!r.ok),[],`${spec.name}/${state} layout`);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);return {state,layout};
}
async function run(spec,task){
  if(match&&!match.test(spec.name))return;
  const context=await browser.newContext({viewport:{width:spec.width,height:900},reducedMotion:"reduce",serviceWorkers:"block"}),errors=[],unexpected=[];
  await context.route("**/*",route=>{unexpected.push(route.request().url());return route.abort();});
  await context.addInitScript(theme=>localStorage.setItem("scoresense-color-theme",theme),spec.theme);await attachDraftFixture(context,{fixture:"management-acquisition"});
  const page=await context.newPage();page.setDefaultTimeout(6000);page.on("pageerror",e=>errors.push(e.message));
  try{
    await page.goto(`http://127.0.0.1:5173/acceptance?surface=${spec.surface}&${spec.query||""}`);await page.locator('main#main-content').waitFor();await frame(page);
    const checks=await task(page);assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
    assert.deepEqual(await page.evaluate(()=>window.__management.requests.filter(r=>!["GET","HEAD"].includes(r.method)&&!window.__management.writes.some(w=>w.url===r.url&&w.method===r.method))),[],"No unrelated write attempts");
    report.cases.push({...spec,passed:true,checks});console.log("PASS",spec.name,spec.width,spec.theme);
  }catch(e){await page.screenshot({path:path.join(output,`failure-${spec.name}-${spec.width}-${spec.theme}.png`)});await fs.writeFile(path.join(output,`failure-${spec.name}-${spec.width}-${spec.theme}.txt`),e.stack+"\n"+await page.locator('body').innerText());report.cases.push({...spec,passed:false,error:e.message});console.log("FAIL",spec.name,spec.width,spec.theme,e.message);}
  finally{await context.close();}
}
async function team(page,id="A"){
  if(page.viewportSize().width<=390){await page.getByRole("button",{name:/^Team to edit/}).click();await page.getByRole("option",{name:`${id} manager 1`,exact:true}).click();}
  else await page.locator('.hub-league-jump-pill').filter({hasText:`${id} manager 1`}).click();
  await page.locator('.hub-league-team-card[open]').waitFor();
}
async function drop(page,id="A"){
  await team(page,id);
  if(page.viewportSize().width<=390){
    const header=page.locator('.mobile-player-card').filter({hasText:`${id} Josh Allen`}).locator('.mobile-player-card-header');
    if(await header.isEnabled()&&await header.getAttribute("aria-expanded")==="false")await header.click();
  }
  await page.getByRole("button",{name:new RegExp(`^(Drop|Queue drop) ${id} Josh Allen`)}).click();await page.getByRole("alertdialog").waitFor();
}
async function openPlayer(page,id="A"){await page.locator('.fa-profile').filter({hasText:`${id} Free player 1`}).click();await page.getByRole("dialog").waitFor();}
async function bid(page,id="A"){await openPlayer(page,id);await page.getByRole("dialog").getByRole("button",{name:"Place bid",exact:true}).click();await page.waitForFunction(()=>window.__management.writes.length===1);}
async function salaryInput(page,id="A"){
  await team(page,id);
  if(page.viewportSize().width<=390){const card=page.locator('.mobile-player-card').filter({hasText:`${id} Josh Allen`});await card.locator('.mobile-player-card-header').click();return card.locator('.hub-roster-edit-input').first();}
  return page.getByRole("spinbutton",{name:new RegExp(`for ${id} Josh Allen$`)}).first();
}
async function sheetSalary(page,id="A"){
  const row=page.locator('.hub-salary-sheet-table tbody tr').filter({hasText:`${id} Josh Allen`}).first();await row.waitFor();
  const edit=row.getByRole("button",{name:"Edit contract",exact:true});if(await edit.count())await edit.click();
  await row.locator('.hub-salary-edit-cell .hub-salary-cap-btn').last().click();
  const input=row.locator('input[type="number"]');await input.fill("35");await input.press("Enter");await page.locator('.hub-salary-review-tray').waitFor();
}
async function saveContracts(page){
  await page.locator('.hub-office-pending-tray').getByRole("button",{name:"Save",exact:true}).click();
  await page.getByRole("dialog").getByRole("textbox").fill("Synthetic staff override");await page.getByRole("dialog").getByRole("button",{name:"Save overrides",exact:true}).click();
}
try{
for(const width of (baseline?[1280]:[1280,390]))for(const theme of (baseline?["dark"]:["light","dark"])){
  let spec={name:"contracts-pending-reset",surface:"contracts",query:"pre=1",width,theme};
  await run(spec,async page=>{const input=await salaryInput(page);await input.fill("35");await input.press("Tab");await page.locator('.hub-office-pending-tray').waitFor();await noWrites(page);await scope(page,"B");await team(page,"B");assert.equal(await page.locator('.hub-office-pending-tray').count(),0,"Staged league A edits cannot appear on league B");await noWrites(page);return baseline?[]:[await inspect(page,spec,"fresh")];});
  spec={name:"contracts-confirm-scope",surface:"contracts",width,theme};
  await run(spec,async page=>{await drop(page);await scope(page,"B");await page.getByRole("alertdialog").locator('.btn-danger').click();await frame(page);await noWrites(page);return baseline?[]:[await inspect(page,spec,"cancelled")];});
  spec={name:"office-readonly",surface:"contracts",query:"readonly=1",width,theme};
  await run(spec,async page=>{assert.equal(await page.locator('.hub-league-rosters').count(),0,"Read-only context cannot mount the staff editor");await noWrites(page);return baseline?[]:[await inspect(page,spec,"restricted")];});
  spec={name:"agents-bid-late",surface:"agents",width,theme};
  await run(spec,async page=>{await bid(page);await scope(page,"B");await openPlayer(page,"B");await page.getByRole("dialog").getByLabel("Your bid",{exact:true}).fill("14");await resolve(page,true);assert.equal(await page.evaluate(()=>window.__management.callbacks.length),0,"Old bid cannot refresh the new context");assert.equal(await page.getByRole("dialog").count(),1,"Old bid cannot close the new sheet");return baseline?[]:[await inspect(page,spec,"retained")];});
  spec={name:"agents-claim-late",surface:"agents",query:"pick=1",width,theme};
  await run(spec,async page=>{await page.locator('.fa-claims-disclosure').locator('summary').click();await page.getByRole("button",{name:"Cancel claim",exact:true}).click();await page.waitForFunction(()=>window.__management.writes.length===1);await scope(page,"B");await page.getByText("B Saved claim",{exact:true}).waitFor({state:"attached"});await resolve(page,true);assert.equal(await page.getByText("B Saved claim",{exact:true}).count(),1,"Old claim response cannot replace B's queue");return baseline?[]:[await inspect(page,spec,"retained")];});
  if(!baseline){
    spec={name:"contracts-newer-edit",surface:"contracts",query:"pre=1",width,theme};
    await run(spec,async page=>{const input=await salaryInput(page);await input.fill("35");await input.press("Tab");await saveContracts(page);await page.waitForFunction(()=>window.__management.writes.length===1);await input.fill("36");await resolve(page,true);assert.equal(await page.locator('.hub-office-pending-tray').count(),1,"New edits made during save must remain staged");assert.equal(await input.inputValue(),"36");return [await inspect(page,spec,"newer")];});
  }
  if(!baseline){
    spec={name:"contracts-failure-retry",surface:"contracts",query:"pre=1",width,theme};
    await run(spec,async page=>{const input=await salaryInput(page);await input.fill("35");await input.press("Tab");await saveContracts(page);await page.waitForFunction(()=>window.__management.writes.length===1);await resolve(page,false);await page.getByText("Synthetic save failed",{exact:true}).first().waitFor();assert.equal(await input.inputValue(),"35");assert.equal(await page.locator('.hub-office-pending-tray').count(),1);const checks=[await inspect(page,spec,"retained")];await saveContracts(page);await page.waitForFunction(()=>window.__management.writes.length===2);await resolve(page,true,1);assert.equal(await page.locator('.hub-office-pending-tray').count(),0);assert.equal(await page.evaluate(()=>window.__management.callbacks.length),1);return checks;});
    spec={name:"contracts-stop-batch",surface:"contracts",query:"pre=1",width,theme};
    await run(spec,async page=>{const input=await salaryInput(page);await input.fill("35");await input.press("Tab");if(width<=390)await page.locator('.mobile-player-card').filter({hasText:"A Bijan Robinson"}).locator('.mobile-player-card-header').click();const second=width<=390?page.locator('.mobile-player-card').filter({hasText:"A Bijan Robinson"}).locator('.hub-roster-edit-input').first():page.getByRole("spinbutton",{name:/for A Bijan Robinson$/}).first();await second.fill("30");await second.press("Tab");await saveContracts(page);await page.waitForFunction(()=>window.__management.writes.length===1);await scope(page,"B");await resolve(page,true);assert.equal(await page.evaluate(()=>window.__management.writes.length),1,"No second write after leaving a staged batch");assert.equal(await page.evaluate(()=>window.__management.callbacks.length),0);return [await inspect(page,spec,"stopped")];});
    spec={name:"contracts-draft-confirm",surface:"contracts",query:"pre=1",width,theme};
    await run(spec,async page=>{await page.getByRole("button",{name:"Mark draft complete",exact:true}).click();await page.getByRole("alertdialog").waitFor();await scope(page,"B");await page.getByRole("alertdialog").locator('.btn-danger').click();await frame(page);await noWrites(page);return [await inspect(page,spec,"cancelled")];});
    for(const pre of [false,true]){
      const variant={name:`moves-${pre?"pre":"post"}`,surface:"moves",query:pre?"pre=1":"",width,theme};
      await run(variant,async page=>{await drop(page);assert.doesNotMatch(await page.locator('body').innerText(),/\$|\bsalary|\bdead cap|\bcontract|\bcommitted/i);await scope(page,"B");await page.getByRole("alertdialog").locator('.btn-danger').click();await noWrites(page);return [await inspect(page,variant,"cancelled")];});
    }
    spec={name:"agents-bid-failure",surface:"agents",width,theme};
    await run(spec,async page=>{await openPlayer(page);const fields=page.locator('.fa-bid-fields input');await fields.nth(1).fill("12");await fields.nth(0).fill("11");await page.getByRole("button",{name:"Place bid",exact:true}).click();await page.waitForFunction(()=>window.__management.writes.length===1);await resolve(page,false);await page.getByRole("alert").waitFor();assert.equal(await fields.nth(0).inputValue(),"11");assert.equal(await fields.nth(1).inputValue(),"12");const checks=[await inspect(page,spec,"retained")];await page.getByRole("button",{name:"Place bid",exact:true}).click();await page.waitForFunction(()=>window.__management.writes.length===2);await resolve(page,true,1);assert.equal(await page.getByRole("dialog").count(),0);assert.equal(await page.evaluate(()=>window.__management.callbacks.length),1);return checks;});
    spec={name:"agents-bid-limits",surface:"agents",query:"lowcap=1",width,theme};
    await run(spec,async page=>{await openPlayer(page);const fields=page.locator('.fa-bid-fields input'),button=page.getByRole("button",{name:"Place bid",exact:true});await fields.nth(0).fill("4");await fields.nth(1).fill("3");assert.equal(await button.isDisabled(),true);await fields.nth(0).fill("2");await fields.nth(1).fill("1");assert.equal(await button.isDisabled(),true);await fields.nth(1).fill("3");assert.equal(await button.isEnabled(),true);await noWrites(page);const checks=[await inspect(page,spec,"preview")];await page.keyboard.press("Escape");await frame(page);assert.equal(await page.getByRole("dialog").count(),0);assert.equal(await page.locator('.fa-profile').filter({hasText:"A Free player 1"}).evaluate(el=>el===document.activeElement),true,await page.evaluate(()=>document.activeElement.outerHTML.slice(0,700)));return checks;});
    spec={name:"agents-claim-failure",surface:"agents",query:"pick=1",width,theme};
    await run(spec,async page=>{await openPlayer(page);await page.getByRole("dialog").locator(".hub-filter-menu").getByRole("button").first().click();await page.getByRole("option",{name:"A Josh Allen",exact:true}).click();await page.getByRole("button",{name:"Confirm claim",exact:true}).click();await page.waitForFunction(()=>window.__management.writes.length===1);assert.equal(await page.evaluate(()=>window.__management.writes[0].body.claims.at(-1).drop_player_id),"allen");await resolve(page,false);await page.getByRole("alert").waitFor();assert.equal(await page.getByRole("dialog").count(),1);assert.equal(await page.getByText("A Saved claim",{exact:true}).count(),1);const checks=[await inspect(page,spec,"retained")];await page.getByRole("button",{name:"Confirm claim",exact:true}).click();await page.waitForFunction(()=>window.__management.writes.length===2);await resolve(page,true,1);assert.equal(await page.getByRole("dialog").count(),0);assert.equal(await page.getByText("A Free player 1",{exact:true}).count()>=1,true);return checks;});
    for(const mode of ["bid","claim","locked"]){
      const variant={name:`agents-readonly-${mode}`,surface:"agents",query:`readonly=1&mode=${mode}${mode==="claim"?"&pick=1":""}`,width,theme};
      await run(variant,async page=>{await openPlayer(page);assert.equal(await page.locator('.fa-confirm').isDisabled(),true);await noWrites(page);return [await inspect(page,variant,"details")];});
    }
    spec={name:"agents-revoke-pending",surface:"agents",width,theme};
    await run(spec,async page=>{await bid(page);await page.evaluate(()=>window.__management.readOnly(true));await frame(page);await resolve(page,false);await page.evaluate(()=>window.__management.readOnly(false));await frame(page);await openPlayer(page);assert.equal(await page.locator('.fa-confirm').isEnabled(),true);assert.doesNotMatch(await page.locator('body').innerText(),/Synthetic save failed/);return [await inspect(page,spec,"ready")];});
    spec={name:"agents-claim-load-failure",surface:"agents",query:"pick=1&read-error=1",width,theme};
    await run(spec,async page=>{await page.getByText("Synthetic read failed",{exact:true}).first().waitFor();assert.doesNotMatch(await page.locator('body').innerText(),/No claims yet|My claims · 0|Order needs commissioner confirmation/);await openPlayer(page);assert.match(await page.getByRole("dialog").innerText(),/Synthetic read failed/);assert.equal(await page.locator('.fa-confirm').isDisabled(),true);await noWrites(page);const checks=[await inspect(page,spec,"blocked")];await page.keyboard.press("Escape");await page.evaluate(()=>window.__management.failReads=false);await scope(page,"B");await page.getByText("B Saved claim",{exact:true}).waitFor({state:"attached"});await openPlayer(page,"B");assert.equal(await page.locator('.fa-confirm').isEnabled(),true);await noWrites(page);return checks;});
    spec={name:"agents-claim-stale-read",surface:"agents",query:"pick=1&delay=1",width,theme};
    await run(spec,async page=>{await page.waitForFunction(()=>window.__management.reads.some(r=>r.league==="A"));await scope(page,"B");await page.waitForFunction(()=>window.__management.reads.some(r=>r.league==="B"));await page.evaluate(()=>window.__management.reads.find(r=>r.league==="B").resolve());await page.getByText("B Saved claim",{exact:true}).waitFor({state:"attached"});await page.evaluate(()=>window.__management.reads.find(r=>r.league==="A").resolve());await frame(page);assert.equal(await page.getByText("A Saved claim",{exact:true}).count(),0);await noWrites(page);return [await inspect(page,spec,"current")];});
    spec={name:"agents-bid-team-change",surface:"agents",width,theme};
    await run(spec,async page=>{await bid(page);await scope(page,"A","other");await openPlayer(page);assert.equal(await page.locator('.fa-confirm').isEnabled(),true);await resolve(page,true);assert.equal(await page.evaluate(()=>window.__management.callbacks.length),0);assert.equal(await page.getByRole("dialog").count(),1);return [await inspect(page,spec,"retained")];});
    spec={name:"agents-protected-claim",surface:"agents",query:"pick=1&protected=1",width,theme};
    await run(spec,async page=>{await page.getByText("A Saved claim",{exact:true}).waitFor({state:"attached"});await openPlayer(page);assert.equal(await page.locator('.fa-confirm').isDisabled(),true);await noWrites(page);return [await inspect(page,spec,"blocked")];});
    spec={name:"office-member",surface:"contracts",query:"member=1",width,theme};
    await run(spec,async page=>{assert.equal(await page.locator('.hub-league-rosters').count(),0);assert.equal(await page.getByRole("button",{name:"Members",exact:true}).count(),0);await noWrites(page);return [await inspect(page,spec,"restricted")];});
    spec={name:"sheets-failure-cancel",surface:"sheets",width,theme};
    await run(spec,async page=>{await sheetSalary(page);await page.getByRole("button",{name:"Review & publish",exact:true}).click();await page.getByRole("dialog").getByRole("textbox").fill("Fixture correction");await page.getByRole("button",{name:"Publish history only",exact:true}).click();await page.waitForFunction(()=>window.__management.writes.length===1);await resolve(page,false);await page.getByText("Synthetic save failed",{exact:true}).waitFor();await page.getByRole("button",{name:"Cancel",exact:true}).click();assert.equal(await page.locator('.hub-salary-review-tray').count(),1);return [await inspect(page,spec,"retained")];});
  }
  if(!baseline){
    spec={name:"contracts-partial-save",surface:"contracts",query:"pre=1",width,theme};
    await run(spec,async page=>{const input=await salaryInput(page);await input.fill("35");await input.press("Tab");if(width<=390)await page.locator('.mobile-player-card').filter({hasText:"A Bijan Robinson"}).locator('.mobile-player-card-header').click();const second=width<=390?page.locator('.mobile-player-card').filter({hasText:"A Bijan Robinson"}).locator('.hub-roster-edit-input').first():page.getByRole("spinbutton",{name:/for A Bijan Robinson$/}).first();await second.fill("30");await second.press("Tab");await saveContracts(page);await page.waitForFunction(()=>window.__management.writes.length===1);await resolve(page,true);await page.waitForFunction(()=>window.__management.writes.length===2);await resolve(page,false,1);await page.waitForFunction(()=>window.__management.callbacks.length===1);assert.match(await page.locator('.hub-office-pending-tray').innerText(),/1 change/);assert.equal(await second.inputValue(),"30");return [await inspect(page,spec,"remaining")];});
    spec={name:"sheets-late-error",surface:"sheets",width,theme};
    await run(spec,async page=>{await sheetSalary(page);await page.getByRole("button",{name:"Review & publish",exact:true}).click();await page.getByRole("dialog").getByRole("textbox").fill("Fixture correction");await page.getByRole("button",{name:"Publish history only",exact:true}).click();await page.waitForFunction(()=>window.__management.writes.length===1);await scope(page,"B");await resolve(page,false);assert.equal(await page.getByRole("dialog").count(),0);assert.doesNotMatch(await page.locator('body').innerText(),/Synthetic save failed/);return [await inspect(page,spec,"retained")];});
  }
  if(!baseline)for(const mode of ["bid","claim","add"]){
    const member={name:`agents-member-${mode}`,surface:"agents",query:`member=1&mode=${mode}${mode!=="bid"?"&pick=1":""}`,width,theme};
    await run(member,async page=>{
      if(mode==="claim")await page.getByText("A Saved claim",{exact:true}).waitFor({state:"attached"});
      await openPlayer(page);assert.equal(await page.locator('.fa-confirm').isEnabled(),true);await page.locator('.fa-confirm').click();await page.waitForFunction(()=>window.__management.writes.length===1);
      assert.equal(await page.evaluate(()=>window.__management.writes[0].body.force||false),false);
      if(mode==="add")assert.equal(await page.evaluate(()=>window.__management.writes[0].body.salary),0);
      await resolve(page,true);assert.equal(await page.getByRole("dialog").count(),0);assert.equal(await page.evaluate(()=>window.__management.callbacks.length),mode==="claim"?0:1);
      if(mode!=="bid")assert.doesNotMatch(await page.locator('body').innerText(),/\$|\bsalary|\bcontract|\bdead cap/i);
      return [await inspect(page,member,"saved")];
    });
  }
  spec={name:"sheets-revoked",surface:"sheets",width,theme};
  await run(spec,async page=>{await sheetSalary(page);await noWrites(page);await page.evaluate(()=>window.__management.permission(false));await frame(page);assert.equal(await page.locator('.hub-salary-review-tray').count(),0,"Revoked role cannot retain a publication action");await noWrites(page);return baseline?[]:[await inspect(page,spec,"readonly")];});
  spec={name:"sheets-confirm-scope",surface:"sheets",width,theme};
  await run(spec,async page=>{await sheetSalary(page);await page.getByRole("button",{name:"Review & publish",exact:true}).click();await page.getByRole("dialog").getByRole("textbox").fill("Fixture correction");await scope(page,"B");await page.getByRole("dialog").getByRole("button",{name:"Publish history only",exact:true}).click();await frame(page);await noWrites(page);return baseline?[]:[await inspect(page,spec,"cancelled")];});
}
if(!baseline)for(const width of [320,1024])for(const theme of ["light","dark"])for(const surface of ["contracts","sheets","agents"]){
  const spec={name:`responsive-${surface}`,surface,width,theme};
  await run(spec,async page=>{
    if(surface==="contracts"){await team(page);if(width<=390)await page.locator('.mobile-player-card').filter({hasText:"A Josh Allen"}).locator('.mobile-player-card-header').click();}
    if(surface==="agents")await openPlayer(page);
    if(surface==="sheets")await page.locator('.hub-salary-sheet-table').waitFor();
    await noWrites(page);return [await inspect(page,spec,"ready")];
  });
}
}finally{await fs.writeFile(path.join(output,baseline?"before-report.json":match?"focused-report.json":"report.json"),JSON.stringify(report,null,2));await browser.close();}
if(report.cases.some(r=>!r.passed))process.exitCode=1;
