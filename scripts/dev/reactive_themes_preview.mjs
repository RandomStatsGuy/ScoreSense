// Browser checks and screenshots for the native HTML scene concepts.
import { chromium } from '../../frontend/node_modules/playwright/index.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { measureScript, NUMERIC_RE, BAR_CONTROL_SELECTOR, TABLE_DEAD_ZONE_PX, COLUMN_PACK_RATIO, GUTTER_EDGE_SELECTORS } from './layout_audit.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const output=path.join(root,'docs/mockups/reactive-themes-review');
await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
const page=await context.newPage();
const errors=[], report=[];
page.on('pageerror',e=>errors.push(e.message));
const theme = id=>page.locator(`input[name="theme"][value="${id}"]`);
const mode = id=>page.locator(`input[name="mode"][value="${id}"]`);
async function geometry(width){
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'horizontal overflow');
  const results=await page.evaluate(measureScript(),{minTarget:width===390?44:32,numericRe:NUMERIC_RE.source,barControlSelector:BAR_CONTROL_SELECTOR,tableDeadZonePx:TABLE_DEAD_ZONE_PX,columnPackRatio:COLUMN_PACK_RATIO,gutterSelectors:GUTTER_EDGE_SELECTORS});
  const failures=results.filter(r=>!r.ok&&['type','selects','collisions','grids'].includes(r.rule));
  assert.deepEqual(failures,[],'layout gate');
  for(const box of await page.locator('.scene-interaction').evaluateAll(elements=>elements.map(e=>{const b=e.getBoundingClientRect();return {w:b.width,h:b.height};})))assert.ok(box.w>=44&&box.h>=44,'toy target size');
}
async function gazeFollowsObject() {
  const ids=await page.locator('.scene-interaction').evaluateAll(els=>els.map(e=>e.dataset.toy));
  for(const id of ids) {
    const target=page.locator(`.scene-interaction[data-toy="${id}"]`);
    for(const [rx,ry] of [[0,0],[1,0],[0,1],[1,1]]) {
      await page.locator('#reactions').uncheck();await page.locator('#reactions').check();
      await target.scrollIntoViewIfNeeded();const hit=await target.boundingBox();
      await page.mouse.move(hit.x+22,hit.y+22);await page.mouse.down();
      const box=await page.locator('.scene-drag-area').boundingBox();
      await page.mouse.move(box.x+box.width*rx,box.y+box.height*ry,{steps:3});await page.waitForTimeout(180);
      const gaze=await page.locator(`[data-buddy="${id}"] .companion-pupil`).evaluate((el,id)=>{
        const origin=new DOMPoint(Number(el.dataset.gazeX),Number(el.dataset.gazeY));
        const face=origin.matrixTransform(el.parentElement.getScreenCTM());
        const pupil=origin.matrixTransform(el.getScreenCTM());
        const target=new DOMPoint(0,0).matrixTransform(document.getElementById(`toy-${id}`).getScreenCTM());
        return {dx:target.x-face.x,dy:target.y-face.y,gx:pupil.x-face.x,gy:pupil.y-face.y};
      },id);
      assert.ok(gaze.dx*gaze.gx+gaze.dy*gaze.gy>0,`${id} eyes must face the object at box corner ${rx},${ry}: ${JSON.stringify(gaze)}`);
      if(Math.abs(gaze.dx)>3)assert.ok(gaze.dx*gaze.gx>0,`${id} horizontal gaze points toward the face-relative target`);
      if(Math.abs(gaze.dy)>3)assert.ok(gaze.dy*gaze.gy>0,`${id} vertical gaze points toward the face-relative target`);
      assert.ok(Math.hypot(gaze.gx,gaze.gy)<2.4,'subtle bounded pupil movement');
      assert.equal(await page.locator('[data-buddy].playing').count(),1,'only the toy owner reacts');
      await page.mouse.up();
    }
  }
  await page.locator('#reactions').uncheck();await page.locator('#reactions').check();
}
async function squareAndPhysics(option,id) {
  const target=page.locator('.scene-interaction').first();
  await target.scrollIntoViewIfNeeded();
  const original=await target.boundingBox();
  await page.mouse.move(original.x+22,original.y+22);await page.mouse.down();
  const area=page.locator('.scene-drag-area');
  const bounds=await area.boundingBox();
  assert.ok(Math.abs(bounds.width-bounds.height)<.5,'drag region is square');
  const stageWidth=await page.locator('#scene-stage > svg').evaluate(el=>el.getBoundingClientRect().width);
  assert.ok(Math.abs(bounds.width/stageWidth*420-100)<.5,'movement square is a modest 100 SVG units');
  await page.mouse.move(bounds.x+bounds.width+100,bounds.y-100,{steps:5});
  const position=()=>page.locator('#scene-stage > svg > #toy-'+(id==='cozy'?'left':id==='snow'?'snow':id==='leaves'?'autumn':'football')).evaluate(el=>{
    const m=el.getScreenCTM();return {x:m.e,y:m.f};
  });
  const atCorner=await position();
  assert.ok(Math.abs(atCorner.x-(bounds.x+bounds.width))<.5&&Math.abs(atCorner.y-bounds.y)<.5,'toy can reach the square corner');
  const hitArea=await target.boundingBox();
  assert.ok(Math.abs(hitArea.x+hitArea.width/2-atCorner.x)<.5&&Math.abs(hitArea.y+hitArea.height/2-atCorner.y)<.5,'toy hit area follows the dragged object');
  if(id==='cozy')await page.locator('.scene-preview').screenshot({path:path.join(output,`${option}-cozy-playing.png`)});
  await page.mouse.up();
  assert.equal(await page.locator('#scene-stage').getAttribute('data-settling'),'true','release starts physics');
  await page.waitForTimeout(150);
  const moving=await position();
  assert.ok(Math.hypot(moving.x-atCorner.x,moving.y-atCorner.y)>.5,'toy continues moving after release');
  assert.ok(moving.x>=bounds.x-.5&&moving.x<=bounds.x+bounds.width+.5&&moving.y>=bounds.y-.5&&moving.y<=bounds.y+bounds.height+.5,'physics stays inside square');
  const movingHitArea=await target.boundingBox();
  assert.ok(Math.abs(movingHitArea.x+movingHitArea.width/2-moving.x)<3&&Math.abs(movingHitArea.y+movingHitArea.height/2-moving.y)<3,'toy remains reachable during physics');
  await page.waitForFunction(()=>document.querySelector('#scene-stage').dataset.settling==='false',null,{timeout:10000});
  const stopped=await position();await page.waitForTimeout(150);const still=await position();
  assert.ok(Math.hypot(stopped.x-still.x,stopped.y-still.y)<.1,'physics comes to rest');
  await page.locator('#reactions').uncheck();await page.locator('#reactions').check();
  console.log(`${option} ${id}: square bounds and release physics passed`);
}
async function skittlesReaction(option) {
  assert.equal(await page.locator('[data-scene-prop="henny"]').count(),1,'Henny bottle on the side table');
  const target=page.locator('[data-toy="football"]');await target.scrollIntoViewIfNeeded();
  const box=await target.boundingBox();await page.mouse.move(box.x+22,box.y+22);await page.mouse.down();
  const area=await page.locator('.scene-drag-area').boundingBox();
  await page.mouse.move(area.x+4,area.y+area.height*.5,{steps:4});
  assert.equal(await page.locator('[data-buddy="football"]').evaluate(el=>el.classList.contains('snack-happy')),true,'Marshawn smiles when candy is near his hand');
  await page.locator('.scene-preview').screenshot({path:path.join(output,`${option}-footballs-happy.png`)});
  await page.mouse.move(area.x+area.width-2,area.y+area.height-2,{steps:4});
  assert.equal(await page.locator('[data-buddy="football"]').evaluate(el=>el.classList.contains('snack-happy')),false,'no reward grin when candy is far away');
  await page.mouse.up();await page.locator('#reactions').uncheck();
  assert.equal(await page.locator('#scene-stage').getAttribute('data-settling'),'false','reactions off cancels physics');
  assert.equal(await page.locator('.scene-interaction').count(),0);
  await page.locator('#reactions').check();
}
try {
  for(const option of ['a','b']){
    for(const width of [390,1280]){
      await page.setViewportSize({width,height:width===390?844:900});
      await page.goto(`http://127.0.0.1:5174/reactive-themes-${option}.html`);
      await page.locator('#scene-stage [data-buddy]').first().waitFor();
      for(const colorMode of ['dark','light']){
        await mode(colorMode).check();
        for(const id of ['cozy','snow','leaves','footballs','none']){
          await theme(id).check(); await geometry(width);
          assert.equal(await page.locator('html').getAttribute('data-theme'),id);
          assert.equal(await page.locator('html').getAttribute('data-mode'),colorMode);
          if(id!=='none')await gazeFollowsObject();
          if(id!=='none'&&width===390&&colorMode==='dark')await squareAndPhysics(option,id);
          if(id==='footballs'&&width===390&&colorMode==='dark')await skittlesReaction(option);
          if(id!=='none'){
            const target=page.locator('.scene-interaction').first();
            await page.mouse.move(5,5);
            assert.equal(await page.locator('#scene-stage').getAttribute('data-playing'),'false','page cursor must not wake companions');
            const box=await target.boundingBox();
            await page.mouse.move(box.x+22,box.y+22); await page.mouse.down();
            await page.mouse.move(box.x+32,box.y+18,{steps:4});
            assert.equal(await page.locator('#scene-stage').getAttribute('data-playing'),'true','drag reaction');
            assert.equal(await page.locator('[data-buddy].playing').count(),1,'only local companion reacts');
            await page.mouse.up();
            await target.focus(); await page.keyboard.press('ArrowLeft');
            assert.equal(await page.locator('#scene-stage').getAttribute('data-playing'),'true','keyboard reaction');
            await page.locator('#reactions').uncheck();
            assert.equal(await page.locator('.scene-interaction').count(),0,'reactions off removes hit areas');
            assert.ok(await page.locator('[data-buddy]').count()>0,'static companion remains');
            assert.equal(await page.locator('.falling-bit').count(),10,'falling field remains');
            await page.locator('#companions').uncheck();
            assert.equal(await page.locator('[data-buddy]').count(),0,'companions off removes scene');
            assert.equal(await page.locator('.falling-bit').count(),10,'falling-only mode');
            await page.locator('#falling').uncheck();
            assert.equal(await page.locator('.falling-bit').count(),0,'colors-only mode');
            assert.ok(await page.locator('.scene-empty').isVisible());
            assert.equal(await page.locator('html').getAttribute('data-theme'),id,'palette preserved');
            await page.locator('#companions').check();
            assert.ok(await page.locator('[data-buddy]').count()>0,'static companions without falling field');
            await page.locator('#falling').check(); await page.locator('#reactions').check();
            if(width===390&&colorMode==='dark')await page.locator('.scene-preview').screenshot({path:path.join(output,`${option}-${id}.png`)});
          }else{
            assert.equal(await page.locator('[data-buddy]').count(),0);
            assert.equal(await page.locator('.falling-bit').count(),0);
          }
          report.push({option,width,theme:id,mode:colorMode,ok:true});
        }
      }
      await theme('cozy').check();await mode('dark').check();
      await page.evaluate(()=>scrollTo(0,0));
      await page.screenshot({path:path.join(output,`${option}-${width}.png`),fullPage:true});
      const summary=page.locator('details summary');
      await summary.focus();await page.keyboard.press('Enter');assert.equal(await page.locator('details').getAttribute('open'),'');
      await page.keyboard.press('Enter');assert.equal(await page.locator('details').getAttribute('open'),null);
      await page.getByRole('link',{name:'← Back'}).click();assert.ok(await page.locator('#preview-toast').isVisible());
    }
    await page.setViewportSize({width:320,height:844});
    await page.goto(`http://127.0.0.1:5174/reactive-themes-${option}.html`);
    await page.locator('#scene-stage [data-buddy]').first().waitFor();
    await page.locator('.account-header h1').evaluate(el=>el.textContent='Account settings and appearance preferences');
    await geometry(320);await page.screenshot({path:path.join(output,`${option}-320-long-title.png`),fullPage:true,animations:'disabled'});
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.waitForFunction(()=>document.querySelectorAll('.scene-interaction').length===0);
    assert.equal(await page.locator('.scene-interaction').count(),0,'reduced motion disables reactions');
    assert.equal(await page.locator('.falling-bit').first().evaluate(el=>getComputedStyle(el).animationName),'none','reduced motion stops particles');
    assert.ok(await page.locator('#reactions').isDisabled());
    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.waitForFunction(()=>document.querySelectorAll('.scene-interaction').length>0);
    await page.getByRole('link',{name:option==='a'?'B':'A',exact:true}).click();
    assert.ok(page.url().endsWith(`reactive-themes-${option==='a'?'b':'a'}.html`),'option navigation');
  }
  assert.deepEqual(errors,[],'browser errors');
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify({ok:true,report,errors},null,2));
  console.log(`${report.length} theme, mode, and width combinations passed; face-relative gaze at all square corners, larger drag bounds, release physics, Skittles proximity, Henny table prop, layer controls, reduced motion, disclosure, navigation, and 320px long-title checks passed.`);
} finally {await browser.close();}
