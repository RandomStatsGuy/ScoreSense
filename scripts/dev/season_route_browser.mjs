// Current App/BrowserRouter acceptance: synthetic reads, every write rejected.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import {attachDraftFixture} from "./draft_fixture_runtime.mjs";
import {measureScript,minTargetForWidth,NUMERIC_RE,BAR_CONTROL_SELECTOR,TABLE_DEAD_ZONE_PX,COLUMN_PACK_RATIO,GUTTER_EDGE_SELECTORS} from "./layout_audit.mjs";
import {MOBILE_CHROME_COPY} from "../../frontend/src/layout/mobileChromePresentation.js";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const require=createRequire(path.join(root,"frontend/package.json"));
const {chromium}=require("playwright");
const output=path.join(root,"outputs/season-route-acceptance");
await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,channel:process.platform==="win32"?"msedge":undefined});
const baseline=process.argv.includes("--baseline");
const report={synthetic:true,currentApp:true,cases:[]};
const pathname=page=>new URL(page.url()).pathname;
async function settled(page){
  await page.waitForFunction(()=>window.__navigationFixture.metadataResolved>0&&window.__navigationFixture.metadataPending===0);
  // Allow React to commit effects scheduled by the final metadata response.
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
}
async function selectedMode(page,width,mode){
  if(width===390)await page.getByRole("button",{name:MOBILE_CHROME_COPY.filters,exact:true}).click();
  const tabs=page.getByRole("tablist",{name:"Season mode",exact:true});
  assert.equal(await tabs.getByRole("tab",{name:mode==="preseason"?"Preseason":"Live",exact:true}).getAttribute("aria-selected"),"true");
  if(width===390)await page.keyboard.press("Escape");
}
async function chooseMode(page,width,mode){
  if(width===390)await page.getByRole("button",{name:MOBILE_CHROME_COPY.filters,exact:true}).click();
  await page.getByRole("tablist",{name:"Season mode",exact:true}).getByRole("tab",{name:mode==="preseason"?"Preseason":"Live",exact:true}).click();
  await page.waitForURL(url=>url.pathname===`/projections/season/${mode}`);
  if(width===390)await page.keyboard.press("Escape");
}
async function enterSeason(page,width){
  if(width===390){
    await page.locator('.app-header-mobile-title-btn').click();
    await page.getByRole("dialog",{name:"Projections",exact:true}).getByRole("button",{name:"Season",exact:true}).click();
  }else await page.getByRole("navigation",{name:"Projection type",exact:true}).getByRole("link",{name:"Season",exact:true}).click();
}
function section(page,width,name){
  return page.getByRole("navigation",{name:width===390?"Main":"Sections",exact:true}).getByRole("link",{name,exact:true});
}
async function inspect(page,spec,state){
  await page.evaluate(()=>scrollTo(0,0));
  const layout=await page.evaluate(measureScript(),{minTarget:minTargetForWidth(spec.width),numericRe:NUMERIC_RE.source,barControlSelector:BAR_CONTROL_SELECTOR,tableDeadZonePx:TABLE_DEAD_ZONE_PX,columnPackRatio:COLUMN_PACK_RATIO,gutterSelectors:GUTTER_EDGE_SELECTORS});
  await page.screenshot({path:path.join(output,`${spec.name}-${spec.width}-${spec.theme}-${state}.png`)});
  assert.deepEqual(layout.filter(row=>!row.ok),[],`${spec.name} layout`);
  assert.equal(await page.locator("main#main-content").count(),1);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  return {state,layout};
}
async function run(spec,task){
  const context=await browser.newContext({viewport:{width:spec.width,height:900},reducedMotion:"reduce",serviceWorkers:"block"});
  const errors=[],unexpected=[];
  await context.route("**/*",route=>{
    const url=new URL(route.request().url());
    if(!(url.hostname==="a.espncdn.com"&&url.pathname==="/combiner/i"&&/^\/i\/teamlogos\/nfl\/500\/[a-z]+\.png$/.test(url.searchParams.get("img")||"")))unexpected.push(url.href);
    return route.abort();
  });
  await context.addInitScript(theme=>localStorage.setItem("scoresense-color-theme",theme),spec.theme);
  await attachDraftFixture(context,{fixture:"navigation-accessibility"});
  const page=await context.newPage();page.setDefaultTimeout(8000);
  page.on("pageerror",error=>errors.push(error.message));
  try{
    await page.goto("http://127.0.0.1:5173"+spec.route);
    if(spec.route.includes("best-ball"))await page.getByRole("heading",{name:"This board",exact:true}).waitFor();
    else await settled(page);
    const checks=await task(page);
    assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
    assert.deepEqual(await page.evaluate(()=>window.__navigationFixture.requests.filter(row=>!["GET","HEAD"].includes(row.method))),[]);
    report.cases.push({...spec,passed:true,checks});console.log("PASS",spec.name,spec.width,spec.theme);
  }catch(error){
    await page.screenshot({path:path.join(output,`failure-${spec.name}-${spec.width}-${spec.theme}.png`)});
    report.cases.push({...spec,passed:false,error:error.message,url:page.url()});console.log("FAIL",spec.name,spec.width,spec.theme,error.message);
  }finally{await context.close();}
}
try{
  for(const width of (baseline?[1280]:[1280,390]))for(const theme of (baseline?["dark"]:["light","dark"]))for(const mode of ["preseason","live"]){
    const opposite=mode==="preseason"?"live":"preseason";
    const spec={name:`explicit-${mode}`,width,theme,route:`/projections/season/${mode}?fixtureMeta=${opposite}&fixtureMetaDelay=150&season=2026&week=6`};
    await run(spec,async page=>{
      assert.equal(pathname(page),`/projections/season/${mode}`,"Metadata cannot replace an explicit linked timeframe");
      await selectedMode(page,width,mode);
      await page.getByText("Example quarterback",{exact:true}).first().waitFor();
      const checks=baseline?[]:[await inspect(page,spec,"linked")];
      if(baseline)return checks;
      await page.reload();await settled(page);
      assert.equal(pathname(page),`/projections/season/${mode}`,"Reload also retains an explicit mode against a conflicting default");
      await selectedMode(page,width,mode);
      assert.equal(await page.locator('.table-meta').filter({hasText:/^1 player$/}).count(),1);
      // A new position reloads metadata; returning to QB must retain the mode.
      const before=await page.evaluate(()=>window.__navigationFixture.metadataResolved);
      if(width===390)await page.getByRole("button",{name:MOBILE_CHROME_COPY.filters,exact:true}).click();
      const positionScope=width===390?page.getByRole("dialog",{name:"Filters",exact:true}):page;
      await positionScope.getByRole("radiogroup",{name:"Position",exact:true}).getByRole("radio",{name:"RB",exact:true}).click();
      await page.waitForFunction(n=>window.__navigationFixture.metadataResolved>n,before);await settled(page);
      const rbResolved=await page.evaluate(()=>window.__navigationFixture.metadataResolved);
      await positionScope.getByRole("radiogroup",{name:"Position",exact:true}).getByRole("radio",{name:"QB",exact:true}).click();
      if(width===390)await page.keyboard.press("Escape");
      await page.waitForFunction(n=>window.__navigationFixture.metadataResolved>n,rbResolved);
      await settled(page);assert.equal(pathname(page),`/projections/season/${mode}`);
      await chooseMode(page,width,opposite);
      await page.goBack();await page.waitForURL(url=>url.pathname===`/projections/season/${mode}`);await selectedMode(page,width,mode);
      await page.goForward();await page.waitForURL(url=>url.pathname===`/projections/season/${opposite}`);
      // Change metadata again before leaving to reproduce the old ref-reset path.
      await page.evaluate(mode=>window.__navigationFixture.metadataMode=mode,mode);
      await section(page,width,"Tools").click();await page.waitForURL(/\/tools\//);
      await section(page,width,"Projections").click();await page.waitForURL(url=>url.pathname===`/projections/season/${opposite}`);
      await settled(page);await selectedMode(page,width,opposite);
      await page.reload();await settled(page);assert.equal(pathname(page),`/projections/season/${opposite}`);
      await selectedMode(page,width,opposite);
      const params=new URL(page.url()).searchParams;
      assert.equal(params.get("season"),"2026");assert.equal(params.get("week"),"6");
      checks.push(await inspect(page,spec,"restored"));
      return {checks,metadataRefresh:true,history:true,remembered:true,reload:true,writes:0};
    });
  }
  if(!baseline)for(const width of [1280,390])for(const theme of ["light","dark"])for(const mode of ["preseason","live"]){
    const spec={name:`automatic-${mode}`,width,theme,route:`/projections/season?fixtureMeta=${mode}&fixtureMetaDelay=150`};
    await run(spec,async page=>{
      await page.waitForURL(url=>url.pathname===`/projections/season/${mode}`);await selectedMode(page,width,mode);
      // Automatic normalization replaces the plain entry instead of trapping Back.
      await section(page,width,"Tools").click();await page.waitForURL(/\/tools\//);
      await page.goBack();await page.waitForURL(url=>url.pathname===`/projections/season/${mode}`);
      // Weekly's desktop link and phone picker both request the automatic default.
      if(width===390){await page.locator('.app-header-mobile-title-btn').click();await page.getByRole("dialog",{name:"Projections",exact:true}).getByRole("button",{name:"Weekly",exact:true}).click();}
      else await page.getByRole("navigation",{name:"Projection type",exact:true}).getByRole("link",{name:"Weekly",exact:true}).click();
      await page.waitForURL(/\/projections\/weekly/);await enterSeason(page,width);
      await page.waitForURL(url=>url.pathname===`/projections/season/${mode}`);
      await page.goBack();await page.waitForURL(/\/projections\/weekly/);
      await page.goForward();await page.waitForURL(url=>url.pathname===`/projections/season/${mode}`);
      return [await inspect(page,spec,"ready")];
    });
  }
  if(!baseline)for(const width of [1280,390])for(const theme of ["light","dark"]){
    const spec={name:"bestball-count",width,theme,route:"/tools/best-ball"};
    await run(spec,async page=>{
      await page.getByRole("heading",{name:"This board",exact:true}).waitFor();
      assert.equal(await page.getByText("1 player",{exact:true}).count(),1);
      assert.equal(await page.getByText("1 players",{exact:true}).count(),0);
      return [await inspect(page,spec,"ready")];
    });
  }
}finally{await fs.writeFile(path.join(output,baseline?"before-report.json":"report.json"),JSON.stringify(report,null,2));await browser.close();}
if(report.cases.some(row=>!row.passed))process.exitCode=1;
