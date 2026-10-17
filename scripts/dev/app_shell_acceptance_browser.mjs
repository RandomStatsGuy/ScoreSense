// Real App shell, synthetic accounts and HTTP; no account/provider writes.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import {attachDraftFixture} from "./draft_fixture_runtime.mjs";
import {measureScript,minTargetForWidth,NUMERIC_RE,BAR_CONTROL_SELECTOR,TABLE_DEAD_ZONE_PX,COLUMN_PACK_RATIO,GUTTER_EDGE_SELECTORS} from "./layout_audit.mjs";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../.."),require=createRequire(path.join(root,"frontend/package.json"));
const {chromium}=require("playwright");
const output=path.join(root,"outputs/app-shell-acceptance");await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,channel:process.platform==="win32"?"msedge":undefined});
const report={synthetic:true,currentApp:true,cases:[]};
const selected=process.argv.includes("--match")?process.argv[process.argv.indexOf("--match")+1]:"";
async function setup(width,theme,route="/hub/home"){
 const context=await browser.newContext({viewport:{width,height:900},reducedMotion:"reduce",serviceWorkers:"block"});
 const errors=[],unexpected=[];
 await context.route("**/*",route=>{const url=new URL(route.request().url());if(url.hostname!=="a.espncdn.com")unexpected.push(url.href);return route.abort();});
 await context.addInitScript(theme=>localStorage.setItem("scoresense-color-theme",theme),theme);
 await attachDraftFixture(context,{fixture:"navigation-accessibility"});
 const page=await context.newPage();page.setDefaultTimeout(6000);page.on("pageerror",e=>errors.push(e.message));
 await page.goto("http://127.0.0.1:5173"+route+"?fixtureShell=1");
 if(route.startsWith("/tools"))await page.getByRole("heading",{name:"This board",exact:true}).waitFor();
 else await picker(page).filter({hasText:/Synthetic/}).waitFor();
 return {context,page,errors,unexpected};
}
async function control(page,method,...args){return page.evaluate(([method,args])=>window.__navigationFixture[method](...args),[method,args]);}
const picker=page=>page.locator('[aria-label*="switch league" i]');
async function league(page,pattern){await picker(page).filter({hasText:pattern}).waitFor();}
async function switchLeague(page){
 if(!await picker(page).evaluate(el=>el.tagName==="SUMMARY"?el.parentElement.open:el.getAttribute("aria-expanded")==="true"))await picker(page).click();
 await page.getByRole("button",{name:/Example pick league/}).click();
}
async function shot(page,state){
 const width=page.viewportSize().width,theme=await page.locator("html").getAttribute("data-theme");
 await page.screenshot({path:path.join(output,`${state}-${width}-${theme}.png`)});
}
async function capture(page,name,width,theme){
 await page.evaluate(()=>scrollTo(0,0));
 const layout=await page.evaluate(measureScript(),{minTarget:minTargetForWidth(width),numericRe:NUMERIC_RE.source,barControlSelector:BAR_CONTROL_SELECTOR,tableDeadZonePx:TABLE_DEAD_ZONE_PX,columnPackRatio:COLUMN_PACK_RATIO,gutterSelectors:GUTTER_EDGE_SELECTORS});
 await page.screenshot({path:path.join(output,`${name}-${width}-${theme}.png`)});
 assert.deepEqual(layout.filter(row=>!row.ok),[],"layout");
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,"no page overflow");
 assert.equal(await page.locator("main#main-content").count(),1,"one main landmark");
 return layout;
}
const cases={
 "explicit-switch":async(page)=>{
  assert.equal(await page.evaluate(()=>__navigationFixture.requests.filter(r=>!["GET","HEAD"].includes(r.method)).length),0,"entry does not write focus");
  await switchLeague(page);await league(page,/Example pick/);
  await page.waitForFunction(()=>__navigationFixture.requests.filter(r=>r.path.includes("workspace")).length>=2);
  assert.equal(await picker(page).filter({hasText:/Synthetic/}).count(),0);
 },
 "failed-switch":async(page)=>{
  await page.evaluate(()=>__navigationFixture.failFocus=true);await switchLeague(page);
  await page.getByRole("alert").filter({hasText:"Example focus failure"}).first().waitFor();
  await league(page,/Synthetic/);await shot(page,"switch-failed-retained");
  await page.evaluate(()=>__navigationFixture.failFocus=false);await switchLeague(page);await league(page,/Example pick/);
 },
 "account-discovered-context":async(page)=>{
  await page.waitForFunction(()=>__navigationFixture.requests.some(r=>r.path.includes("/navigation-fixture/chat/summary")));
  const departed=await page.evaluate(()=>__navigationFixture.requests.length);
  await control(page,"setIdentity","other-user");
  await page.waitForFunction(()=>__navigationFixture.requests.some(r=>r.identity==="other-user"&&r.path.includes("/other-account-fixture/chat/summary")));
  assert.equal(await page.evaluate(start=>__navigationFixture.requests.slice(start).filter(r=>r.identity==="other-user"&&r.path.includes("/navigation-fixture/chat")).length,departed),0,"discovered chat context belongs to the account that loaded it");
 },
 "account-while-away":async(page)=>{
  const phone=page.viewportSize().width===390;
  const section=name=>page.getByRole("navigation",{name:phone?"Main":"Sections",exact:true}).getByRole("link",{name,exact:true});
  await section("Tools").click();await page.waitForURL(/\/tools\//);
  const departed=await page.evaluate(()=>__navigationFixture.requests.length);
  await control(page,"setIdentity","other-user");
  await page.waitForFunction(()=>__navigationFixture.renderedIdentity==="other-user");
  await page.waitForFunction(()=>__navigationFixture.requests.some(r=>r.identity==="other-user"&&r.path.includes("/chat/summary")));
  assert.equal(await page.evaluate(start=>__navigationFixture.requests.slice(start).filter(r=>r.identity==="other-user"&&r.path.includes("/navigation-fixture/chat")).length,departed),0,"new account never requests former account's chat");
  await section("Fantasy").click();await page.waitForURL(/\/hub\//);await league(page,/Other account/);
 },
 "account-replacement":async(page)=>{
  await control(page,"holdWorkspace");await control(page,"setIdentity","other-user");
  await page.waitForFunction(()=>__navigationFixture.renderedIdentity==="other-user");
  assert.equal(await picker(page).filter({hasText:/Synthetic/}).count(),0,"old account league removed while new account loads");
  await shot(page,"account-loading");
  await control(page,"releaseWorkspace");await league(page,/Other account/);
 },
 "account-during-focus":async(page)=>{
  await control(page,"holdFocus");await switchLeague(page);await page.waitForFunction(()=>__navigationFixture.focusPending===1);
  await control(page,"setIdentity","other-user");await league(page,/Other account/);
  await control(page,"releaseFocus");await page.waitForFunction(()=>__navigationFixture.focusPending===0);
  await page.waitForTimeout(100);
  await league(page,/Other account/);
  assert.equal(await page.evaluate(()=>__navigationFixture.requests.filter(r=>r.path.includes("workspace")&&r.identity==="other-user").length),1,"old focus completion cannot launch a new account refresh");
 },
 "account-roundtrip":async(page)=>{
  await control(page,"holdFocus");await switchLeague(page);await page.waitForFunction(()=>__navigationFixture.focusPending===1);
  await control(page,"setIdentity","other-user");await league(page,/Other account/);
  await control(page,"setIdentity","navigation-user");await league(page,/Synthetic/);
  await control(page,"releaseFocus");await page.waitForFunction(()=>__navigationFixture.focusPending===0);
  await page.waitForTimeout(100);await league(page,/Synthetic/);
 },
 "older-bootstrap":async(page)=>{
  await control(page,"holdWorkspace");await page.evaluate(()=>dispatchEvent(new Event("scoresense-auth-changed")));
  await page.waitForFunction(()=>__navigationFixture.workspacePending===1);
  await switchLeague(page);await league(page,/Example pick/);
  await control(page,"releaseWorkspace");await page.waitForFunction(()=>__navigationFixture.workspacePending===0);
  await page.waitForTimeout(100);await league(page,/Example pick/);
 },
 "older-bootstrap-error":async(page)=>{
  await page.evaluate(()=>__navigationFixture.failWorkspace=true);
  await control(page,"holdWorkspace");await page.evaluate(()=>dispatchEvent(new Event("scoresense-auth-changed")));
  await page.waitForFunction(()=>__navigationFixture.workspacePending===1);
  await page.evaluate(()=>__navigationFixture.failWorkspace=false);
  await switchLeague(page);await league(page,/Example pick/);
  await control(page,"releaseWorkspace");await page.waitForFunction(()=>__navigationFixture.workspacePending===0);
  await page.waitForTimeout(100);await league(page,/Example pick/);
  assert.equal(await page.getByText("Example workspace failure",{exact:true}).count(),0,"obsolete errors do not cover a successful switch");
 },
 "pending-bootstrap-failed-switch":async(page)=>{
  await control(page,"holdWorkspace");await page.evaluate(()=>dispatchEvent(new Event("scoresense-auth-changed")));
  await page.waitForFunction(()=>__navigationFixture.workspacePending===1);
  await page.evaluate(()=>__navigationFixture.failFocus=true);await switchLeague(page);
  await page.getByRole("alert").filter({hasText:"Example focus failure"}).first().waitFor();
  await control(page,"releaseWorkspace");await page.waitForFunction(()=>__navigationFixture.workspacePending===0);
  await page.waitForTimeout(100);await league(page,/Synthetic/);
  await page.evaluate(()=>__navigationFixture.failFocus=false);await switchLeague(page);await league(page,/Example pick/);
 },
 "sign-out-during-focus":async(page)=>{
  await control(page,"holdFocus");await switchLeague(page);await page.waitForFunction(()=>__navigationFixture.focusPending===1);
  await control(page,"setIdentity","signed-out");
  await page.waitForFunction(()=>document.body.textContent.includes("Sign in"));
  await control(page,"releaseFocus");await page.waitForFunction(()=>__navigationFixture.focusPending===0);
  await page.waitForTimeout(100);
  assert.equal(await picker(page).count(),0,"signed out shell has no former league picker");
  assert.equal(await page.locator(".hub-league-context-name").filter({hasText:"Example pick league"}).count(),0);
 }
};
try{
 for(const [name,exercise] of Object.entries(cases)){
  if(selected&&!name.includes(selected))continue;
  for(const width of [1280,390])for(const theme of ["light","dark"]){
   const {context,page,errors,unexpected}=await setup(width,theme,name==="account-discovered-context"?"/tools/best-ball":"/hub/home");const result={name,width,theme};
   try{await exercise(page);result.layout=await capture(page,name,width,theme);assert.deepEqual(errors,[],"no page errors");assert.deepEqual(unexpected,[],"no external requests");const writes=await page.evaluate(()=>__navigationFixture.requests.filter(r=>!["GET","HEAD"].includes(r.method)));assert(writes.every(r=>r.path==="/api/hub/active-league"&&r.method==="PUT"),"only named synthetic focus writes");result.writes=writes.length;result.pass=true;console.log(`PASS ${name} ${width} ${theme}`);}
   catch(error){result.pass=false;result.error=error.message;await page.screenshot({path:path.join(output,`${name}-${width}-${theme}-failure.png`)});console.log(`FAIL ${name} ${width} ${theme}: ${error.message}`);}
   finally{report.cases.push(result);await context.close();}
  }
 }
}finally{await browser.close();await fs.writeFile(path.join(output,"report.json"),JSON.stringify(report,null,2));}
if(report.cases.some(c=>!c.pass))process.exitCode=1;
