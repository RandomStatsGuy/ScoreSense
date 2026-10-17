// Current supporting surfaces with synthetic source-shaped data and blocked external I/O.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createRequire} from "node:module";
import {attachDraftFixture} from "./draft_fixture_runtime.mjs";
import {measureScript,minTargetForWidth,NUMERIC_RE,BAR_CONTROL_SELECTOR,TABLE_DEAD_ZONE_PX,COLUMN_PACK_RATIO,GUTTER_EDGE_SELECTORS} from "./layout_audit.mjs";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../.."),require=createRequire(path.join(root,"frontend/package.json"));
const {chromium}=require("playwright"),output=path.join(root,"outputs/design-closeout/browser");await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,channel:process.platform==="win32"?"msedge":undefined});
const cases=["model-ready","model-missing","admin","verify-success","verify-error","verify-waiting","callback-safe","callback-unsafe","public-ready","public-empty","public-error","lobby-practice","lobby-full","lobby-member","lobby-missing"];
const selected=process.argv.includes("--match")?process.argv[process.argv.indexOf("--match")+1]:"";
const report={synthetic:true,productionComponents:true,cases:[]};
async function inspect(page,name,width,theme,state="ready"){
 await page.evaluate(()=>scrollTo(0,0));
 const layout=await page.evaluate(measureScript(),{minTarget:minTargetForWidth(width),numericRe:NUMERIC_RE.source,barControlSelector:BAR_CONTROL_SELECTOR,tableDeadZonePx:TABLE_DEAD_ZONE_PX,columnPackRatio:COLUMN_PACK_RATIO,gutterSelectors:GUTTER_EDGE_SELECTORS});
 await page.screenshot({path:path.join(output,`${name}-${width}-${theme}-${state}.png`),animations:"disabled"});
 assert.deepEqual(layout.filter(r=>!r.ok),[],"layout");assert.equal(await page.locator("main#main-content").count(),1,"one main landmark");
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,"no page overflow");
 assert.equal(await page.locator("html").getAttribute("data-theme"),theme);
 return {state,layout};
}
try{for(const name of cases){if(selected&&!name.includes(selected))continue;for(const width of [1280,390])for(const theme of ["light","dark"]){
 const context=await browser.newContext({viewport:{width,height:900},reducedMotion:"reduce",serviceWorkers:"block"}),errors=[],unexpected=[];
 await context.route("**/*",route=>{const u=new URL(route.request().url());if(u.hostname!=="a.espncdn.com")unexpected.push(u.href);return route.abort();});
 await context.addInitScript(theme=>localStorage.setItem("scoresense-color-theme",theme),theme);await attachDraftFixture(context,{fixture:"design-closeout"});
 const page=await context.newPage();page.setDefaultTimeout(7000);page.on("pageerror",e=>errors.push(e.message));const result={name,width,theme,checks:[]};
 try{
 await page.goto("http://127.0.0.1:5173/acceptance?case="+name);await page.locator("main#main-content").waitFor();
 if(name.startsWith("callback")){
  const expected=name==="callback-safe"?"/account":"/projections/weekly";
  await page.waitForFunction(expected=>__closeout.path===expected,expected);assert.equal(await page.evaluate(()=>__closeout.getToken()),"example-fixture-token");
  assert.equal((await page.locator("body").innerText()).includes("example-fixture-token"),false);
 }else if(name==="model-ready"){
  await page.getByRole("heading",{name:"How close were we each season?",exact:true}).waitFor();assert(await page.locator(".recharts-surface").count()>0,"populated charts");
  await page.waitForTimeout(1700); // Capture the completed Recharts line, not its JS entry animation.
 }else if(name==="model-missing")await page.getByText(/Accuracy backtests aren't available yet/).waitFor();
 else if(name==="admin"){
  await page.getByText("example@example.test",{exact:true}).filter({visible:true}).first().waitFor();result.checks.push(await inspect(page,name,width,theme,"users"));
  await page.getByRole("navigation",{name:"Admin sections"}).getByRole("button",{name:"Leagues",exact:true}).click();
  await page.getByText(/Example long league name for directory review/).filter({visible:true}).last().waitFor();result.checks.push(await inspect(page,name,width,theme,"leagues"));
  await page.getByRole("navigation",{name:"Admin sections"}).getByRole("button",{name:"Overview",exact:true}).click();
  await page.waitForFunction(()=>__closeout.requests.some(r=>r.path.includes("/ops/overview")));
 }else if(name.startsWith("verify")){
  await page.getByRole("heading",{name:"Confirm your email.",exact:true}).waitFor();
  await page.getByText(name==="verify-success"?"Your email is verified. You can use Fantasy and saved features.":name==="verify-error"?"This verification link is invalid or expired.":"Check your inbox for a verification link.",{exact:true}).first().waitFor();
 }else if(name.startsWith("public")){
  if(name==="public-error"){
   await page.getByRole("button",{name:"Try again",exact:true}).waitFor();result.checks.push(await inspect(page,name,width,theme,"unavailable"));
   await page.evaluate(()=>__closeout.failRoom=false);await page.getByRole("button",{name:"Try again",exact:true}).click();
  }
  await page.getByRole("heading",{name:"Example public team",exact:true}).waitFor();
  assert.equal(await page.getByRole("link",{name:/Game center/}).count(),0,"public room omits private matchup link");
  assert.equal(await page.getByRole("button",{name:/Share room|Edit room|Save lineup|Manage roster/}).count(),0,"public room has no owner writers");
  if(name!=="public-empty"){
   const locker=page.getByRole("button",{name:"Open Example quarterback's locker",exact:true});await locker.click();assert.equal(await locker.getAttribute("aria-expanded"),"true");
   await page.keyboard.press("Escape");assert.equal(await locker.evaluate(el=>el===document.activeElement),true);
  }
 }else if(name==="lobby-practice"){
  const input=page.getByLabel("Your name in this room",{exact:true});await input.fill("Example guest");await page.getByRole("button",{name:"Take a seat",exact:true}).click();
  await page.getByRole("alert").filter({hasText:"Example join failure"}).waitFor();assert.equal(await input.inputValue(),"Example guest");
  await page.getByRole("button",{name:"Take a seat",exact:true}).click();await page.waitForFunction(()=>__closeout.requests.filter(r=>r.method==="POST").length===2);
 }else if(name==="lobby-member"){
  await page.getByRole("heading",{name:"Sign in to enter the draft",exact:true}).waitFor();assert.equal(await page.getByRole("button",{name:"Take a seat",exact:true}).count(),0);
 }else if(name==="lobby-full"){
  await page.getByText("Ask the host for a new link if you still need a seat.",{exact:true}).waitFor();assert.equal(await page.getByRole("button",{name:"Take a seat",exact:true}).count(),0);
 }else if(name==="lobby-missing")await page.getByRole("heading",{name:"This lobby is gone.",exact:true}).waitFor();
 result.checks.push(await inspect(page,name,width,theme));
 const writes=await page.evaluate(()=>__closeout.requests.filter(r=>!["GET","HEAD"].includes(r.method)));
 assert(writes.every(r=>name==="lobby-practice"&&r.method==="POST"&&r.path.endsWith("/join")),"only named synthetic rejected joins");
 assert.deepEqual(errors,[],"no runtime errors");assert.deepEqual(unexpected,[],"no unexpected external requests");result.passed=true;console.log("PASS",name,width,theme);
 }catch(error){result.passed=false;result.error=error.message;await page.screenshot({path:path.join(output,`${name}-${width}-${theme}-failure.png`)});console.log("FAIL",name,width,theme,error.message);}
 finally{report.cases.push(result);await context.close();}
}}}finally{await browser.close();await fs.writeFile(path.join(output,selected?"focused-report.json":"report.json"),JSON.stringify(report,null,2));}
if(!report.cases.length||report.cases.some(r=>!r.passed))process.exitCode=1;
