// Current production Rules/setup, deterministic requests and synthetic writes only.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import {attachDraftFixture} from "./draft_fixture_runtime.mjs";
import {measureScript,minTargetForWidth,NUMERIC_RE,BAR_CONTROL_SELECTOR,TABLE_DEAD_ZONE_PX,COLUMN_PACK_RATIO,GUTTER_EDGE_SELECTORS} from "./layout_audit.mjs";
import {RULES_COPY,SCORING_COPY} from "../../frontend/src/DraftHub/rulesPresentation.js";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../.."),require=createRequire(path.join(root,"frontend/package.json"));
const {chromium}=require("playwright"),output=path.join(root,"outputs/rules-state-acceptance");
await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,channel:process.platform==="win32"?"msedge":undefined});
const baseline=process.argv.includes("--baseline"),report={synthetic:true,productionComponents:true,cases:[]};
const category=(page,name)=>page.getByRole("navigation",{name:RULES_COPY.categoryTitle,exact:true}).getByRole("button",{name,exact:true});
const nameInput=page=>page.getByRole("textbox",{name:/^League name/});
const save=page=>page.getByRole("button",{name:RULES_COPY.save,exact:true});
async function foundation(page){await category(page,"League format").click();await nameInput(page).waitFor();}
async function queued(page,n){await page.waitForFunction(n=>window.__rulesFixture.saves.length===n,n);}
async function resolve(page,index,options={}){await page.evaluate(({index,options})=>window.__rulesFixture.saves[index].resolve(options),{index,options});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));}
async function switchTo(page,id){await page.evaluate(id=>window.__rulesFixture.switchLeague(id),id);await page.waitForFunction(id=>document.querySelector('.hub-rules-summary h3')?.textContent===`Example league ${id}`,id);}
async function inspect(page,spec,state){
  await page.evaluate(()=>scrollTo(0,0));
  const layout=await page.evaluate(measureScript(),{minTarget:minTargetForWidth(spec.width),numericRe:NUMERIC_RE.source,barControlSelector:BAR_CONTROL_SELECTOR,tableDeadZonePx:TABLE_DEAD_ZONE_PX,columnPackRatio:COLUMN_PACK_RATIO,gutterSelectors:GUTTER_EDGE_SELECTORS});
  await page.screenshot({path:path.join(output,`${spec.name}-${spec.width}-${spec.theme}-${state}.png`)});
  assert.deepEqual(layout.filter(row=>!row.ok),[],`${spec.name}/${state} layout`);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  if(await save(page).count())assert.equal(await save(page).evaluate(el=>getComputedStyle(el).whiteSpace),"nowrap","Save label stays on one line");
  if(spec.width<=768&&await page.locator('.hub-rules-status').count()){
    assert.equal(await page.locator('.hub-rules-sticky-save .hub-rules-status').evaluate(el=>{
      const b=el.getBoundingClientRect();return b.top>=0&&b.bottom<=innerHeight&&el.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2));
    }),true,"Save outcome stays visible beside the action on phone");
  }
  return {state,layout};
}
async function run(spec,task){
  const context=await browser.newContext({viewport:{width:spec.width,height:900},reducedMotion:"reduce",serviceWorkers:"block"});
  const errors=[],unexpected=[];
  await context.route("**/*",route=>{unexpected.push(route.request().url());return route.abort();});
  await context.addInitScript(theme=>localStorage.setItem("scoresense-color-theme",theme),spec.theme);
  await attachDraftFixture(context,{fixture:"rules-state"});
  const page=await context.newPage();page.setDefaultTimeout(7000);page.on("pageerror",e=>errors.push(e.message));
  try{
    await page.goto(`http://127.0.0.1:5173/hub/${spec.page||"rules"}?role=${spec.role||"commissioner"}&format=${spec.format||"auction"}&host=${spec.host||"native"}&page=${spec.page||"rules"}`);
    await page.locator(spec.page==="setup"?'.hub-setup':'.hub-rules-center').waitFor();
    const checks=await task(page);
    assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
    assert.deepEqual(await page.evaluate(()=>window.__rulesFixture.requests.filter(r=>!["GET","HEAD"].includes(r.method)&&!(r.method==="PUT"&&r.url==="/api/hub/workspace"))),[],"No link, sync, import, focus or other write");
    report.cases.push({...spec,passed:true,checks});console.log("PASS",spec.name,spec.width,spec.theme);
  }catch(error){
    await page.screenshot({path:path.join(output,`failure-${spec.name}-${spec.width}-${spec.theme}.png`)});
    await fs.writeFile(path.join(output,`failure-${spec.name}-${spec.width}-${spec.theme}.txt`),error.stack+"\n"+await page.locator("body").innerText());
    report.cases.push({...spec,passed:false,error:error.message});console.log("FAIL",spec.name,spec.width,spec.theme,error.message);
  }finally{await context.close();}
}
try{
  for(const width of (baseline?[1280]:[1280,390]))for(const theme of (baseline?["dark"]:["light","dark"]))for(const kind of (baseline?["newer-edit","late-success"]:["newer-edit","late-success","late-error","overlap","round-trip"])){
    const spec={name:kind,width,theme};
    await run(spec,async page=>{
      await foundation(page);await nameInput(page).fill("Submitted A");await save(page).click();await queued(page,1);
      assert.equal(await page.evaluate(()=>window.__rulesFixture.saves[0].body.league_id),"A","Save targets the form league");
      if(kind==="newer-edit"){
        await nameInput(page).fill("Newer unsaved A");await resolve(page,0,{normalizeName:"Normalized saved A"});
        assert.equal(await nameInput(page).inputValue(),"Newer unsaved A","Successful save must retain post-submit edits");
        assert.equal(await save(page).isEnabled(),true);assert.equal(await page.getByText(RULES_COPY.unsavedChanges,{exact:true}).count(),1);
        if(baseline)return {retained:true};
        const checks=[await inspect(page,spec,"newer-edits")];
        await page.getByRole("button",{name:RULES_COPY.discard,exact:true}).click();
        assert.equal(await nameInput(page).inputValue(),"Normalized saved A","Discard uses the acknowledged normalized baseline");
        assert.equal(await save(page).isDisabled(),true);return checks;
      }
      await switchTo(page,"B");
      if(kind==="overlap"){
        await nameInput(page).fill("Submitted B");await save(page).click();await queued(page,2);
        await resolve(page,0);assert.equal(await page.getByRole("button",{name:RULES_COPY.saving,exact:true}).isDisabled(),true,"Old completion cannot unlock a new source's pending save");
        assert.equal(await nameInput(page).inputValue(),"Submitted B");await resolve(page,1);
        assert.equal(await nameInput(page).inputValue(),"Submitted B");
        assert.deepEqual(await page.evaluate(()=>window.__rulesFixture.callbacks.map(c=>c.meta.boundLeagueId)),["B"]);
      }else{
        if(kind==="round-trip"){await switchTo(page,"A");await nameInput(page).fill("New visit A");}
        await resolve(page,0,{ok:kind!=="late-error"});
        assert.equal(await nameInput(page).inputValue(),kind==="round-trip"?"New visit A":"Example league B","Obsolete completion cannot change the current source");
        assert.equal(await page.locator('.hub-rules-status').count(),0,"No obsolete success/error in the current form");
        assert.equal(await page.evaluate(()=>window.__rulesFixture.callbacks.length),0,"Obsolete saves never invoke captured parent callbacks");
        assert.equal(await save(page).isDisabled(),kind!=="round-trip");
      }
      return baseline?{retained:true}:[await inspect(page,spec,"settled")];
    });
  }
  if(!baseline)for(const width of [1280,390])for(const theme of ["light","dark"]){
    const spec={name:"late-template",width,theme};
    await run(spec,async page=>{
      await page.locator('.hub-rules-category-templates summary').click();
      await page.getByRole("button",{name:"Pick template",exact:true}).click();
      await page.getByRole("alertdialog").waitFor();await switchTo(page,"B");
      await page.getByRole("button",{name:RULES_COPY.templateConfirm,exact:true}).click();
      assert.equal(await category(page,"Contracts").count(),1,"Old template confirmation cannot replace a new league's rules");
      assert.equal(await save(page).isDisabled(),true);assert.equal(await page.evaluate(()=>window.__rulesFixture.saves.length),0);
      return [await inspect(page,spec,"retained")];
    });
  }
  if(!baseline)for(const width of [1280,390,320])for(const theme of ["light","dark"]){
    const spec={name:"failed-save",width,theme};
    await run(spec,async page=>{
      await foundation(page);await nameInput(page).fill("");
      assert.equal(await nameInput(page).getAttribute("aria-invalid"),"true");assert.equal(await save(page).isDisabled(),true);
      assert.equal(await page.evaluate(()=>window.__rulesFixture.saves.length),0);
      const checks=[await inspect(page,spec,"invalid")];
      await nameInput(page).fill("Retained draft");await category(page,"Roster limits").click();await category(page,"League format").click();
      assert.equal(await nameInput(page).inputValue(),"Retained draft");await save(page).click();await queued(page,1);
      checks.push(await inspect(page,spec,"pending"));await resolve(page,0,{ok:false});
      await page.getByText("Synthetic save 1 failed",{exact:true}).waitFor();
      assert.equal(await nameInput(page).inputValue(),"Retained draft");assert.equal(await save(page).isEnabled(),true);
      checks.push(await inspect(page,spec,"error"));await save(page).click();await queued(page,2);await resolve(page,1);
      await page.getByText(RULES_COPY.saved,{exact:true}).waitFor();assert.equal(await save(page).isDisabled(),true);
      checks.push(await inspect(page,spec,"saved"));return checks;
    });
  }
  const variants=[{role:"commissioner",format:"auction",host:"native"},{role:"member",format:"auction",host:"native"},{role:"commissioner",format:"snake",host:"sleeper"},{role:"member",format:"linear",host:"sleeper"}];
  if(!baseline)for(const width of [1280,390])for(const theme of ["light","dark"])for(const v of variants)for(const pageName of ["rules","setup"]){
    const spec={name:`${pageName}-${v.role}-${v.format}-${v.host}`,width,theme,...v,page:pageName};
    await run(spec,async page=>{
      const checks=[];
      if(pageName==="rules"){
        if(v.host==="sleeper"){
          assert.equal(await page.getByRole("link",{name:SCORING_COPY.openSleeper,exact:true}).getAttribute("href"),"https://sleeper.com/leagues/synthetic-A");
          assert.equal(await page.getByLabel("Reception",{exact:true}).count(),0);
        }else assert.equal(await page.getByLabel("Reception",{exact:true}).isDisabled(),v.role==="member");
        assert.equal(await category(page,"Manager names").count(),v.role==="commissioner"?1:0);
        checks.push(await inspect(page,spec,"scoring"));await foundation(page);
        assert.equal(await nameInput(page).isDisabled(),v.role==="member");
        assert.equal(await save(page).count(),v.role==="commissioner"?1:0);
        if(v.format!=="auction"){
          assert.equal(await category(page,"Contracts").count(),0);assert.equal(await category(page,"Draft behavior").count(),0);
          assert.equal(await page.getByLabel("Team salary cap",{exact:true}).count(),0);
          assert.doesNotMatch(await page.locator('.hub-rules-summary').innerText(),/\$|dead cap|salary/i);
        }
        checks.push(await inspect(page,spec,"format"));
      }else{
        assert.equal(await page.getByRole("button",{name:v.role==="member"?"View league rules":"Open league rules",exact:true}).count(),1);
        assert.equal(await page.locator('.hub-setup-panel--league summary').count(),0);
        assert.equal(await page.locator('.hub-setup-alt').count(),v.role==="commissioner"?1:0);
        assert.equal(await page.getByRole("button",{name:/Save draft|Clear draft|Mark draft complete/}).count(),0);
        checks.push(await inspect(page,spec,"ready"));
        // Only open the existing connection disclosure; never link or sync.
        const details=page.locator('details.hub-setup-panel--sleeper');
        if(!(await details.evaluate(el=>el.open)))await details.locator(':scope > summary').click();
        checks.push(await inspect(page,spec,"connection"));
        await page.getByRole("button",{name:v.role==="member"?"View league rules":"Open league rules",exact:true}).click();
        await page.locator('.hub-rules-center').waitFor();assert.equal(await save(page).count(),v.role==="commissioner"?1:0);
      }
      assert.equal(await page.evaluate(()=>window.__rulesFixture.saves.length),0);return checks;
    });
  }
  if(!baseline)for(const width of [1280,390])for(const theme of ["light","dark"]){
    const spec={name:"templates-and-leave",width,theme};
    await run(spec,async page=>{
      const reception=page.getByLabel("Reception",{exact:true});await reception.fill("0.5");
      await page.locator('.hub-rules-category-templates summary').click();await page.getByRole("button",{name:"Pick template",exact:true}).click();
      await page.getByRole("alertdialog").waitFor();await page.keyboard.press("Escape");assert.equal(await reception.inputValue(),"0.5");
      await page.getByRole("button",{name:"Pick template",exact:true}).click();await page.getByRole("button",{name:RULES_COPY.templateConfirm,exact:true}).click();
      assert.equal(await reception.inputValue(),"0.5","Template retains scoring weights");assert.equal(await category(page,"Contracts").count(),0);
      assert.equal(await page.evaluate(()=>window.__rulesFixture.saves.length),0);
      await page.getByRole("button",{name:RULES_COPY.templateUndo,exact:true}).click();assert.equal(await category(page,"Contracts").count(),1);
      await page.evaluate(()=>{void window.__rulesFixture.navigate("setup");});await page.getByRole("alertdialog").waitFor();
      for(let i=0;i<6;i++)await page.keyboard.press(i%2?"Shift+Tab":"Tab");
      assert.equal(await page.evaluate(()=>!!document.activeElement.closest('[role="alertdialog"]')),true);
      await page.getByRole("button",{name:RULES_COPY.keepEditing,exact:true}).click();assert.equal(await reception.inputValue(),"0.5");
      const checks=[await inspect(page,spec,"retained")];
      await foundation(page);await nameInput(page).fill("Pending on leave");await save(page).click();await queued(page,1);
      await page.evaluate(()=>{void window.__rulesFixture.navigate("setup");});await page.getByRole("button",{name:RULES_COPY.leaveConfirm,exact:true}).click();
      await page.locator('.hub-setup').waitFor();await resolve(page,0);
      assert.equal(await page.evaluate(()=>window.__rulesFixture.callbacks.length),0,"Unmounted editor ignores late completion");
      checks.push(await inspect(page,spec,"left"));return checks;
    });
  }
}finally{await fs.writeFile(path.join(output,baseline?"before-report.json":"report.json"),JSON.stringify(report,null,2));await browser.close();}
if(report.cases.some(row=>!row.passed))process.exitCode=1;
