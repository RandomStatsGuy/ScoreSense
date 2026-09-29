import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import {measureScript,NUMERIC_RE,BAR_CONTROL_SELECTOR,TABLE_DEAD_ZONE_PX,COLUMN_PACK_RATIO,GUTTER_EDGE_SELECTORS} from './layout_audit.mjs';
const require=createRequire(new URL('../../frontend/package.json',import.meta.url));
const {chromium}=require('playwright');
const out='outputs/my-team-review';
await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});
const report=[];
try {
 for(const width of [320,390,1280]) {
  const page=await browser.newPage({viewport:{width,height:900}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://**/*',r=>r.abort());
  const visit=async(state='salary',extra='')=>{
   await page.goto(`http://127.0.0.1:5173/test-fixtures/roster-mobile.html?state=${state}${extra}`);
   await page.getByRole('button',{name:state==='standard'?'Player details':'Manage roster',exact:true}).click();
   await page.locator('.my-team-overview').waitFor();
  };
  const audit=async(state)=>{
   const results=await page.evaluate(measureScript(),{minTarget:width<=768?44:32,numericRe:NUMERIC_RE.source,barControlSelector:BAR_CONTROL_SELECTOR,tableDeadZonePx:TABLE_DEAD_ZONE_PX,columnPackRatio:COLUMN_PACK_RATIO,gutterSelectors:GUTTER_EDGE_SELECTORS});
   report.push({width,state,results});
   const bad=results.filter(r=>!r.ok);
   if(bad.length)console.log(JSON.stringify({width,state,bad}));
  };
  await visit(); await audit('salary');
  assert.match(await page.locator('.my-team-overview').innerText(),/Available Cap\s+\$42/);
  await page.screenshot({path:`${out}/roster-${width}.png`,fullPage:true});
  await page.getByRole('button',{name:'QB 2',exact:true}).click();
  assert.equal(await page.locator('.my-team-player').count(),2);
  await page.getByRole('button',{name:'All 8',exact:true}).click();
  await page.getByRole('button',{name:'Search roster',exact:true}).click();
  await page.getByRole('searchbox',{name:'Search roster'}).fill('Allen');
  assert.equal(await page.locator('.my-team-player').count(),1);
  await page.getByRole('button',{name:'Contract · Josh Allen',exact:true}).press('Enter');
  assert.equal(await page.locator('#my-team-contract-title').evaluate(e=>e===document.activeElement),true);
  assert.equal(await page.getByRole('button',{name:'Remove without penalty',exact:true}).count(),0);
  await audit('contract');
  await page.screenshot({path:`${out}/contract-${width}.png`});
  await page.getByRole('button',{name:'Cut',exact:true}).click();
  await page.getByRole('alertdialog').waitFor();
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.fixtureWrites.length),0);
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('button',{name:'Contract · Josh Allen',exact:true}).evaluate(e=>e===document.activeElement),true);
  await page.getByRole('button',{name:'Search roster',exact:true}).click();
  assert.equal(await page.locator('.my-team-player').count(),8);
  for(const state of ['predraft','standard','empty','loading','cut']) {
   await visit(state); await audit(state);
   if(state==='predraft') {
    assert.match(await page.locator('.my-team-overview').innerText(),/Leftover for draft\s+\$76/);
    await page.getByRole('button',{name:'Contract · James Cook',exact:true}).click();
    await page.getByRole('button',{name:'Queue extension',exact:true}).click();
    await page.getByRole('button',{name:/Undo extension/}).waitFor();
    await page.getByRole('button',{name:/Undo extension/}).click();
    await page.getByRole('button',{name:'Queue extension',exact:true}).waitFor();
    const writes=await page.evaluate(()=>window.fixtureWrites);
    assert.deepEqual(writes.map(w=>w.path),['/api/hub/contract/rookie-extend','/api/hub/contract/rookie-extend/cancel']);
   }
   if(state==='standard') {
    assert.doesNotMatch(await page.locator('.my-team-page').innerText(),/\$|[Cc]ap|[Cc]ontract|[Ss]alary/);
    await page.getByRole('button',{name:'Player details · Josh Allen',exact:true}).click();
    assert.doesNotMatch(await page.getByRole('dialog').innerText(),/\$|[Cc]ap|[Cc]ontract|[Ss]alary/);
   }
   if(state==='empty')assert.equal(await page.locator('.my-team-controls').count(),0);
   if(state==='loading')assert.equal(await page.locator('[aria-busy=true]').count(),1);
   if(state==='cut') {
    await page.getByRole('button',{name:'Contract · Josh Allen',exact:true}).click();
    assert.equal(await page.getByRole('button',{name:/Undo cut is closed/}).isDisabled(),true);
   }
  }
  await visit('salary','&staff=1&long=1'); await audit('long-owner-staff');
  await page.locator('.my-team-player').first().click();
  assert.equal(await page.getByRole('button',{name:'Remove without penalty',exact:true}).count(),1);
  await page.keyboard.press('Escape');
  await visit('write-error');
  await page.getByRole('button',{name:'Contract · Josh Allen',exact:true}).click();
  await page.getByRole('button',{name:'Cut',exact:true}).click();
  await page.getByRole('alertdialog').getByRole('button',{name:'Cut',exact:true}).click();
  await page.getByRole('dialog').getByText('Could not save the roster change.',{exact:true}).waitFor();
  assert.deepEqual(errors,[]);
  await page.close();
  console.log(`PASS controls ${width}: search, positions, modal focus, cut cancel/error, extension/undo, salary/standard, empty/loading, staff/member, claimed cut`);
 }
}finally{
 await fs.writeFile(`${out}/audit.json`,JSON.stringify(report,null,2));
 await browser.close();
}
assert.deepEqual(report.flatMap(item=>item.results.filter(r=>!r.ok).map(r=>({width:item.width,state:item.state,...r}))),[]);
