// Current App route/keyboard regression with synthetic reads and no real writes.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import {measureScript,minTargetForWidth,NUMERIC_RE,BAR_CONTROL_SELECTOR,TABLE_DEAD_ZONE_PX,COLUMN_PACK_RATIO,GUTTER_EDGE_SELECTORS} from "./layout_audit.mjs";
import {MOBILE_CHROME_COPY} from "../../frontend/src/layout/mobileChromePresentation.js";
import {attachDraftFixture} from "./draft_fixture_runtime.mjs";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../.."),require=createRequire(path.join(root,"frontend/package.json"));
const {chromium}=require("playwright");
const output=path.join(root,"outputs/navigation-accessibility");
await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,channel:process.platform==="win32"?"msedge":undefined});
const notifyOnly=process.argv.includes("--notify-only");
const report={synthetic:true,currentApp:true,cases:[]};
async function setup(width=390,height=360,theme="dark",route="/tools/best-ball"){
  const context=await browser.newContext({viewport:{width,height},reducedMotion:"reduce",serviceWorkers:"block"});
  const errors=[],unexpected=[];
  await context.route("**/*",route=>{
    const url=new URL(route.request().url());
    if(!(url.hostname==="a.espncdn.com"&&url.pathname==="/combiner/i"&&/^\/i\/teamlogos\/nfl\/500\/[a-z]+\.png$/.test(url.searchParams.get("img")||"")))unexpected.push(url.href);
    return route.abort();
  });
  await context.addInitScript(theme=>localStorage.setItem("scoresense-color-theme",theme),theme);
  await attachDraftFixture(context,{fixture:"navigation-accessibility"});
  const page=await context.newPage();page.setDefaultTimeout(8000);
  page.on("pageerror",error=>errors.push(error.message));
  await page.goto("http://127.0.0.1:5173"+route);
  if(route.includes("consumer="))await page.getByRole("heading",{name:"Shared sheet consumer",exact:true}).waitFor();
  else if(route.includes("best-ball"))await page.getByRole("heading",{name:"This board",exact:true}).waitFor();
  else if(route.includes("projections"))await page.getByText("Example quarterback",{exact:true}).first().waitFor();
  else await page.getByRole("heading",{name:"This Week",exact:true}).waitFor();
  if(!route.includes("consumer="))await page.waitForFunction(()=>document.querySelector('.notification-bell'));
  return {context,page,errors,unexpected};
}
async function focusInfo(page){return page.evaluate(()=>{
  const el=document.activeElement,box=el.getBoundingClientRect(),head=document.querySelector('.app-mobile-sheet-grip')?.getBoundingClientRect();
  return {label:el.getAttribute("aria-label")||el.textContent.trim(),top:box.top,bottom:box.bottom,headerBottom:head?.bottom,
    inside:!!el.closest('[role="dialog"]'),covered:!el.contains(document.elementFromPoint(box.x+box.width/2,box.y+box.height/2))};
});}
// Computed navigation colors only. Gradients are checked at their resolved stop
// colors; images/unsupported colors are reported for manual inspection.
async function contrastReview(page){return page.evaluate(()=>{
  const parse=value=>{
    if(value.startsWith("#")){const hex=value.slice(1);if(hex.length===6)return [0,2,4].map(i=>parseInt(hex.slice(i,i+2),16)).concat(1);}
    const values=value.match(/[+-]?(?:\d*\.)?\d+(?:e[+-]?\d+)?/gi)?.map(Number);
    if(!values||values.length<3)return null;
    if(value.startsWith("color(srgb "))return values.slice(0,3).map(v=>v*255).concat(values[3]??1);
    if(value.startsWith("rgb"))return values.slice(0,3).concat(values[3]??1);
    return null;
  };
  const blend=(fg,bg)=>fg.slice(0,3).map((v,i)=>v*fg[3]+bg[i]*(1-fg[3])).concat(1);
  const luminance=color=>color.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
  const ratio=(fg,bg)=>{const a=luminance(blend(fg,bg)),b=luminance(bg);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);};
  const backgrounds=el=>{
    const layers=[];
    for(let node=el;node;node=node.parentElement){
      const style=getComputedStyle(node),color=parse(style.backgroundColor);
      if(style.backgroundImage!=="none"){
        const stops=style.backgroundImage.match(/(?:rgba?|color)\([^()]+\)/g)?.map(parse).filter(Boolean);
        if(!stops?.length||stops.some(stop=>stop[3]!==1))return null;
        return stops.map(stop=>layers.slice().reverse().reduce((bg,layer)=>blend(layer,bg),stop));
      }
      if(color){layers.push(color);if(color[3]===1)return [layers.slice().reverse().reduce((bg,layer)=>blend(layer,bg),color)];}
    }
    return null;
  };
  const rows=[];
  for(const el of document.querySelectorAll('.app-header-shell a,.app-header-shell button,.app-bottom-nav-item,.app-mobile-sheet button,.app-mobile-sheet a,.user-menu-item')){
    if(!el.getClientRects().length||el.closest('[inert]')||el.disabled||getComputedStyle(el).visibility==='hidden')continue;
    const style=getComputedStyle(el),fg=parse(style.color),bgs=backgrounds(el),text=el.textContent.trim(),label=el.getAttribute('aria-label')||text;
    const required=!text||text==='×'||parseFloat(style.fontSize)>=24||(parseFloat(style.fontSize)>=18.6667&&Number(style.fontWeight)>=700)?3:4.5;
    rows.push({label,foreground:style.color,backgrounds:bgs,ratio:fg&&bgs?Math.min(...bgs.map(bg=>ratio(fg,bg))):null,required});
  }
  const focused=document.activeElement,focusStyle=getComputedStyle(focused);
  if(focused.matches(":focus-visible")&&parseFloat(focusStyle.outlineWidth)>0){
    const fg=parse(focusStyle.outlineColor),bgs=backgrounds(focused.parentElement);
    rows.push({label:"Focus ring",foreground:focusStyle.outlineColor,backgrounds:bgs,ratio:fg&&bgs?Math.min(...bgs.map(bg=>ratio(fg,bg))):null,required:3});
  }
  return rows;
});}

async function audit(page,spec,state){
  await page.evaluate(()=>scrollTo(0,0));
  const layout=await page.evaluate(measureScript(),{minTarget:minTargetForWidth(spec.width),numericRe:NUMERIC_RE.source,barControlSelector:BAR_CONTROL_SELECTOR,tableDeadZonePx:TABLE_DEAD_ZONE_PX,columnPackRatio:COLUMN_PACK_RATIO,gutterSelectors:GUTTER_EDGE_SELECTORS});
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
  const file=`${spec.product}-${state}-${spec.width}-${spec.theme}`;
  await page.screenshot({path:path.join(output,file+".png")});
  assert.equal(overflow,false,"Page fits the requested CSS width");
  assert.deepEqual(layout.filter(row=>!row.ok),[],file+" layout");
  const contrast=await contrastReview(page);
  assert.deepEqual(contrast.filter(row=>row.ratio!=null&&row.ratio<row.required),[],file+" navigation contrast");
  return {state,layout,overflow,contrast};
}
async function cycle(page,count=14){
  const steps=[];
  for(const key of ["Tab","Shift+Tab"])for(let i=0;i<count;i++){
    await page.keyboard.press(key);steps.push(await focusInfo(page));
  }
  assert.deepEqual(steps.filter(step=>!step.inside||step.covered),[],"Every forward/reverse focused action remains visible");
  return steps;
}
async function run(spec,task){
  const {context,page,errors,unexpected}=await setup(spec.width,spec.height||900,spec.theme,spec.route);
  try{
    const checks=await task(page);
    assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
    assert.deepEqual(await page.evaluate(()=>window.__navigationFixture.requests.filter(row=>!["GET","HEAD"].includes(row.method))),[],"Navigation never writes saved league/account state");
    report.cases.push({...spec,passed:true,checks});console.log("PASS",spec.name,spec.width,spec.theme);
  }catch(error){
    await page.screenshot({path:path.join(output,`failure-${spec.name}-${spec.width}-${spec.theme}.png`)});
    await fs.writeFile(path.join(output,`failure-${spec.name}-${spec.width}-${spec.theme}.txt`),error.stack+"\n"+await page.locator("body").innerText());
    report.cases.push({...spec,passed:false,error:error.message});console.log("FAIL",spec.name,error.message);
  }finally{await context.close();}
}
const products=[{product:"projections",route:"/projections/weekly",title:"Weekly"},{product:"preseason",route:"/projections/season/preseason",title:"Season"},{product:"live-season",route:"/projections/season/live",title:"Season"},{product:"fantasy",route:"/hub/home",title:"This Week"},{product:"tools",route:"/tools/best-ball",title:"Best ball"}];
try{
  if(!notifyOnly)for(const width of [320,390])for(const theme of ["light","dark"])for(const textScale of [1,2]){
    const spec={name:"short-more",product:"tools",route:"/tools/best-ball",width,height:360,theme,textScale};
    await run(spec,async page=>{
      if(textScale===2)await page.evaluate(()=>document.documentElement.style.fontSize="200%");
      await page.getByRole("button",{name:"More",exact:true}).click();
      const dialog=page.getByRole("dialog",{name:"More",exact:true});
      assert.equal(await dialog.evaluate(el=>getComputedStyle(el).animationName),"none","Sheet entry respects reduced motion");
      const steps=await cycle(page);
      assert.equal(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true,"Menu reflows with doubled text");
      await page.screenshot({path:path.join(output,`more-${width}-${theme}-${textScale}x.png`)});
      await page.keyboard.press("Escape");
      assert.equal(await page.getByRole("button",{name:"More",exact:true}).evaluate(el=>el===document.activeElement),true);
      assert.equal(await page.locator("#root").evaluate(el=>el.inert),false);
      return {steps,contrast:await contrastReview(page)};
    });
  }
  for(const width of (notifyOnly?[1280]:[1280,1024,390]))for(const theme of (notifyOnly?["dark"]:["light","dark"]))for(const product of (notifyOnly?[products.at(-1)]:products)){
    const spec={name:"navigation",...product,width,height:900,theme};
    await run(spec,async page=>{
      await page.getByRole("link",{name:"Skip to content",exact:true}).press("Enter");
      assert.equal(await page.locator("#main-content").evaluate(el=>el===document.activeElement),true);
      if(product.product==="preseason"){
        await page.waitForURL(/\/projections\/season\/preseason/);
        if(width>768)assert.equal(await page.getByRole("tab",{name:"Preseason",exact:true}).getAttribute("aria-selected"),"true");
      }
      const checks=[await audit(page,spec,"ready")];
      if(width>768){
        await page.getByRole("button",{name:"Example manager",exact:true}).press("Enter");
        assert.equal(await page.getByRole("menuitem",{name:"Account settings",exact:true}).evaluate(el=>el===document.activeElement),true);
        await page.keyboard.press("End");
        assert.equal(await page.getByRole("menuitem",{name:"Log out",exact:true}).evaluate(el=>el===document.activeElement),true);
        await page.keyboard.press("Home");await page.keyboard.press("ArrowDown");
        await page.keyboard.press("Escape");
        assert.equal(await page.getByRole("button",{name:"Example manager",exact:true}).evaluate(el=>el===document.activeElement),true);
        await page.getByRole("button",{name:"Example manager",exact:true}).press("Enter");
        await page.getByRole("menuitem",{name:"Notification settings",exact:true}).click();
        await page.getByRole("button",{name:"Close notifications",exact:true}).press("Escape");
        assert.equal(await page.getByRole("button",{name:"Example manager",exact:true}).evaluate(el=>el===document.activeElement),true,"Closing notifications returns to the account trigger, even though its menu item unmounted");
        await page.screenshot({path:path.join(output,`${product.product}-notification-return-${width}-${theme}.png`)});
      }else{
        const trigger=page.getByRole("button",{name:`${product.title}, choose destination`,exact:true});
        await trigger.press("Enter");
        await cycle(page,8);
        await page.keyboard.press("Escape");
        assert.equal(await trigger.evaluate(el=>el===document.activeElement),true);
        await page.getByRole("button",{name:"More",exact:true}).press("Enter");
        await cycle(page);
        checks.push(await audit(page,spec,"more"));
        await page.keyboard.press("Escape");
        await page.getByRole("button",{name:"More",exact:true}).press("Enter");
        await page.getByRole("dialog",{name:"More",exact:true}).getByRole("button",{name:"Notification settings",exact:true}).click();
        await page.getByRole("button",{name:"Close notifications",exact:true}).press("Escape");
        assert.equal(await page.getByRole("button",{name:"More",exact:true}).evaluate(el=>el===document.activeElement),true);
        // A hidden sheet after rotation releases inertness, scroll lock and trapping.
        await trigger.click();await page.setViewportSize({width:1024,height:900});
        assert.equal(await page.locator("#root").evaluate(el=>el.inert),false);
        assert.notEqual(await page.locator("body").evaluate(el=>el.style.overflow),"hidden");
        await page.setViewportSize({width,height:900});await page.keyboard.press("Escape");
      }
      if(product.product==="projections"){
        if(width===390){
          const filters=page.getByRole("button",{name:MOBILE_CHROME_COPY.filters,exact:true});
          await filters.click();await page.getByRole("dialog",{name:"Filters",exact:true}).waitFor();
          await cycle(page,16);checks.push(await audit(page,spec,"filters"));await page.keyboard.press("Escape");
          assert.equal(await filters.evaluate(el=>el===document.activeElement),true);
        }
        const player=page.getByRole("button",{name:/^Open Example quarterback.*details$/}).first();
        await player.click();await page.getByRole("dialog").waitFor();
        await cycle(page,16);checks.push(await audit(page,spec,"player"));await page.keyboard.press("Escape");
        assert.equal(await player.evaluate(el=>el===document.activeElement),true);
      }
      return checks;
    });
  }
  if(!notifyOnly)for(const width of [390,320])for(const theme of ["light","dark"])for(const consumer of ["journey","history","import"]){
    const spec={name:consumer,product:consumer,route:`/test-fixtures/navigation-accessibility.html?consumer=${consumer}`,width,height:700,theme};
    await run(spec,async page=>{
      const trigger=consumer==="journey"?page.getByRole("button",{name:"Open contract journey",exact:true}):consumer==="history"?page.getByRole("button",{name:"Add row",exact:true}):page.getByRole("button",{name:"Upload cap sheet (TSV)",exact:true});
      await trigger.click();await page.getByRole("dialog").waitFor();
      if(consumer==="history")assert.equal(await page.locator('.hub-contract-edit input.search-input').evaluateAll(inputs=>inputs.length>0&&inputs.every(input=>input.offsetHeight>=44)),true,"Phone contract text fields meet the target floor");
      await cycle(page,12);
      const checks=[await audit(page,spec,"sheet")];
      if(consumer==="journey"){
        const size=await page.locator('.app-mobile-sheet').evaluate(el=>({measured:parseFloat(el.style.getPropertyValue('--sheet-header-block-size')),actual:el.querySelector('.app-mobile-sheet-grip').offsetHeight}));
        assert.equal(size.measured,size.actual,"Wrapped contract title has measured clearance");
      }
      await page.keyboard.press("Escape");
      assert.equal(await trigger.evaluate(el=>el===document.activeElement),true);
      return checks;
    });
  }
  if(!notifyOnly)for(const theme of ["light","dark"]){
    const spec={name:"palettes",product:"palettes",route:"/test-fixtures/navigation-accessibility.html?consumer=import",width:390,height:700,theme};
    await run(spec,async page=>{
      await page.getByRole("button",{name:"Upload cap sheet (TSV)",exact:true}).click();
      const rows=[];
      for(const palette of ["none","cozy","snow","leaves","footballs"]){
        await page.evaluate(palette=>document.documentElement.dataset.experienceTheme=palette,palette);
        const button=page.getByRole("button",{name:"Yes, validate file",exact:true});
        for(const state of ["default","hover"]){
          if(state==="hover")await button.hover();else await page.mouse.move(0,0);
          const samples=await contrastReview(page);
          assert.deepEqual(samples.filter(row=>row.ratio!=null&&row.ratio<row.required),[],palette+" "+state+" contrast");
          rows.push({palette,state,samples});
        }
      }
      return rows;
    });
  }
  if(!notifyOnly)for(const width of [1280,390])for(const theme of ["light","dark"]){
    const spec={name:"route-journey",product:"tools",route:"/tools/best-ball",width,height:900,theme};
    await run(spec,async page=>{
      const section=name=>page.getByRole("navigation",{name:width===390?"Main":"Sections",exact:true}).getByRole("link",{name,exact:true});
      if(width===390){
        await section("Tools").click();
        await page.getByRole("dialog",{name:"Tools",exact:true}).getByRole("button",{name:"Mock draft",exact:true}).click();
      }else await page.getByRole("navigation",{name:"Tools",exact:true}).getByRole("link",{name:"Mock draft",exact:true}).click();
      await page.waitForURL(/\/tools\/mock-draft/);
      await section("Projections").click();
      if(width===390){await page.locator('.app-header-mobile-title-btn').click();await page.getByRole("dialog",{name:"Projections",exact:true}).getByRole("button",{name:"Season",exact:true}).click();}
      else await page.getByRole("navigation",{name:"Projection type",exact:true}).getByRole("link",{name:"Season",exact:true}).click();
      await page.waitForURL(/\/projections\/season/);
      await section("Tools").click();await page.waitForURL(/\/tools\/mock-draft/);
      await page.goBack();await page.waitForURL(/\/projections\/season/);
      await page.reload();await page.waitForURL(/\/projections\/season/);
      assert.equal(await page.locator('main#main-content').count(),1);
      return {rememberedTool:"mock-draft",backAndReload:"season",writes:0};
    });
  }
}finally{await fs.writeFile(path.join(output,"report.json"),JSON.stringify(report,null,2));await browser.close();}
if(report.cases.some(row=>!row.passed))process.exitCode=1;
