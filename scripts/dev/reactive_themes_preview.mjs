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
async function catGazeFollowsToy() {
  for(const id of ['left','right']) {
    const target=page.locator(`[data-toy="${id}"]`);
    const buddy=page.locator(`[data-buddy="${id}"]`);
    for(const key of ['ArrowLeft','ArrowRight']) {
      // Reset each attempt so direction is measured from the same resting toy.
      await page.locator('#reactions').uncheck();await page.locator('#reactions').check();
      await target.focus();await page.keyboard.down(key);
      await page.waitForTimeout(180);
      const offset=await buddy.evaluate(el=>{
        const pupil=el.querySelector('.awake-eyes .companion-pupil circle');
        const iris=el.querySelector('.awake-eyes ellipse');
        const center=new DOMPoint(pupil.cx.baseVal.value,pupil.cy.baseVal.value);
        // Compare the pupil to its unmoved location in the actual rendered iris.
        return center.matrixTransform(pupil.getScreenCTM()).x-center.matrixTransform(iris.getScreenCTM()).x;
      });
      assert.ok(key==='ArrowLeft'?offset<-.1:offset>.1,`${id} cat pupils must follow ${key} in screen coordinates; got ${offset}`);
      assert.equal(await page.locator('[data-buddy].playing').count(),1,'only the toy owner reacts');
      const other=page.locator(`[data-buddy="${id==='left'?'right':'left'}"] .awake-eyes`);
      assert.equal(await other.isVisible(),false,'other cat stays asleep');
      await page.keyboard.up(key);
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
          if(id==='cozy')await catGazeFollowsToy();
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
  console.log(`${report.length} theme, mode, and width combinations passed; mirrored cat gaze, square drag bounds, release physics, Skittles proximity, layer controls, reduced motion, disclosure, navigation, and 320px long-title checks passed.`);
} finally {await browser.close();}
