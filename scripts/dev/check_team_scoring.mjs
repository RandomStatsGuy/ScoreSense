import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {createRequire} from "node:module";
import {measureScript,minTargetForWidth,NUMERIC_RE,BAR_CONTROL_SELECTOR,TABLE_DEAD_ZONE_PX,COLUMN_PACK_RATIO,GUTTER_EDGE_SELECTORS} from "./layout_audit.mjs";
const require=createRequire(new URL("../../frontend/package.json",import.meta.url));
const {chromium}=require("playwright");
const browser=await chromium.launch({headless:true});
const out="outputs/team-season-scoring";
await fs.mkdir(out,{recursive:true});
const results=[];
const audits=[];
const audit=async(page,width,state)=>{
  const checks=await page.evaluate(measureScript(),{minTarget:minTargetForWidth(width),numericRe:NUMERIC_RE.source,barControlSelector:BAR_CONTROL_SELECTOR,tableDeadZonePx:TABLE_DEAD_ZONE_PX,columnPackRatio:COLUMN_PACK_RATIO,gutterSelectors:GUTTER_EDGE_SELECTORS});
  audits.push({width,state,checks});
  const failures=checks.filter(c=>!c.ok&&["type","selects","collisions","grids","overflow"].includes(c.rule));
  assert.deepEqual(failures,[],`${width} ${state} layout`);
};
try {
  for(const width of [320,390,1280]) {
    const page=await browser.newPage({viewport:{width,height:900}});
    const errors=[];page.on("pageerror",e=>errors.push(e.message));
    await page.emulateMedia({reducedMotion:"reduce"});
    for(const state of ["standard","salary"]) {
      await page.goto(`http://127.0.0.1:5173/test-fixtures/roster-mobile.html?state=${state}`,{waitUntil:"networkidle"});
      await page.getByRole("button",{name:state==="standard"?"Player details":"Manage roster",exact:true}).click();
      const row=page.locator(".my-team-player").filter({hasText:"Josh Allen"});
      await row.locator(".my-team-season-numbers").waitFor();
      assert.match(await row.innerText(),/69\.4/);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      await audit(page,width,state);
      if(width>=390)await page.screenshot({path:`${out}/${state}-${width}.png`});
      await row.click();
      const dialog=page.getByRole("dialog");
      await dialog.waitFor();
      assert.equal(await dialog.locator(".my-team-game-log li").count(),3);
      assert.match(await dialog.innerText(),/↑ \+6\.9/);
      assert.match(await dialog.innerText(),/↓ -3\.6/);
      assert.equal(await dialog.locator(".my-team-game-log li").last().locator(".is-positive,.is-caution").count(),0);
      assert.equal(await page.evaluate(()=>document.activeElement.id),"my-team-contract-title");
      await audit(page,width,`detail-${state}`);
      if(width>=390)await page.screenshot({path:`${out}/detail-${state}-${width}.png`});
      await page.keyboard.press("Escape");
      assert.equal(await row.evaluate(el=>el===document.activeElement),true);
      results.push({width,state,pass:true});
    }
    for (const [state, extra] of [["empty",""],["loading",""],["standard","&long"],["standard","&score-error"]]) {
      await page.goto(`http://127.0.0.1:5173/test-fixtures/roster-mobile.html?state=${state}${extra}`,{waitUntil:"networkidle"});
      await page.getByRole("button",{name:state==="standard"?"Player details":"Manage roster",exact:true}).click();
      await audit(page,width,`${state}${extra}`);
      if(extra.includes("score-error")) assert.match(await page.locator(".my-team-season-caption").innerText(),/Scores unavailable/);
      results.push({width,state:`${state}${extra}`,pass:true});
    }
    await page.goto("http://127.0.0.1:5173/test-fixtures/team-room.html?state=final",{waitUntil:"networkidle"});
    const jersey=page.locator(".team-room-locker-trigger").nth(1);
    await jersey.scrollIntoViewIfNeeded();
    const before=await jersey.boundingBox();
    await jersey.click();
    const after=await jersey.boundingBox();
    assert.ok(Math.abs(before.x-after.x)<2,`Right jersey moved horizontally at ${width}`);
    assert.ok(Math.abs(before.width-after.width)<2,`Right jersey resized at ${width}`);
    assert.ok(Math.abs(before.y-after.y)<2,`Right jersey jumped vertically at ${width}`);
    const drawer=page.locator(".team-room-drawer");
    const box=await drawer.boundingBox();
    assert.ok(box.x>=0&&box.x+box.width<=width,`Drawer clipped at ${width}`);
    await audit(page,width,"right-locker");
    if(width>=390) {
      await drawer.scrollIntoViewIfNeeded();
      await page.screenshot({path:`${out}/right-locker-${width}.png`});
    }
    await drawer.getByRole("button",{name:"Close locker",exact:true}).click();
    assert.equal(await jersey.evaluate(el=>el===document.activeElement),true);
    await jersey.click();
    await page.keyboard.press("Escape");
    assert.equal(await drawer.count(),0);
    assert.deepEqual(errors,[]);
    results.push({width,state:"right locker open/close/Escape",pass:true});
    await page.close();
  }
  await fs.writeFile(`${out}/checks.json`,JSON.stringify(results,null,2));
  await fs.writeFile(`${out}/layout.json`,JSON.stringify(audits,null,2));
  console.table(results);
} finally {await browser.close();}
