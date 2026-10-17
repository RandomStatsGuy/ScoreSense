// Existing production My team Lineup fixture, isolated from all real APIs.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import {attachDraftFixture} from "./draft_fixture_runtime.mjs";
import {measureScript,minTargetForWidth,NUMERIC_RE,BAR_CONTROL_SELECTOR,TABLE_DEAD_ZONE_PX,COLUMN_PACK_RATIO,GUTTER_EDGE_SELECTORS} from "./layout_audit.mjs";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../.."),require=createRequire(path.join(root,"frontend/package.json")),{chromium}=require("playwright");
const output=path.join(root,"outputs/vibes-lineup-consumer");await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,channel:process.platform==="win32"?"msedge":undefined}),report=[];
try{for(const state of ["ready","missing","linked","readonly"])for(const width of [1280,390])for(const theme of ["dark","light"]){
 const context=await browser.newContext({viewport:{width,height:960},reducedMotion:"reduce",serviceWorkers:"block"});
 await context.route("**/*",route=>route.abort());await context.addInitScript(theme=>{localStorage.setItem("scoresense-color-theme",theme);localStorage.setItem("ss_vibe_aura_fixture:fixture:mine_2026_2",JSON.stringify({waddle:64,smith:64}));},theme);
 await attachDraftFixture(context,{fixture:"lineup-picker"});const page=await context.newPage(),errors=[];page.setDefaultTimeout(5000);page.on("pageerror",e=>errors.push(e.message));
 try{await page.goto(`http://127.0.0.1:5173/test-fixtures/lineup-picker.html?state=${state}`);
  // This older isolated fixture predates main's global theme stylesheet.
  await page.addStyleTag({content:await fs.readFile(path.join(root,"frontend/src/styles/color-theme.css"),"utf8")});
  await page.getByText("Jalen Hurts",{exact:true}).first().waitFor();
  if(["ready","missing"].includes(state)){await page.getByRole("button",{name:"Change FLEX: Jaylen Waddle",exact:true}).click();await page.getByRole("dialog").waitFor();}
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),theme);
  const layout=await page.evaluate(measureScript(),{minTarget:minTargetForWidth(width),numericRe:NUMERIC_RE.source,barControlSelector:BAR_CONTROL_SELECTOR,tableDeadZonePx:TABLE_DEAD_ZONE_PX,columnPackRatio:COLUMN_PACK_RATIO,gutterSelectors:GUTTER_EDGE_SELECTORS});
  await page.screenshot({path:path.join(output,`${state}-${width}-${theme}.png`)});assert.deepEqual(layout.filter(r=>!r.ok),[]);assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>window.fixtureWrites),[]);
  report.push({state,width,theme,passed:true,layout});console.log("PASS",state,width,theme);
 }catch(error){report.push({state,width,theme,passed:false,error:error.message});console.log("FAIL",state,width,theme,error.message);}finally{await context.close();}
}}finally{await fs.writeFile(path.join(output,"report.json"),JSON.stringify(report,null,2));await browser.close();}
if(report.some(c=>!c.passed))process.exitCode=1;
