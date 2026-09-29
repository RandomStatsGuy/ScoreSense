import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {measureScript,NUMERIC_RE,BAR_CONTROL_SELECTOR,TABLE_DEAD_ZONE_PX,COLUMN_PACK_RATIO,GUTTER_EDGE_SELECTORS} from './layout_audit.mjs';
const require=createRequire(new URL('../../frontend/package.json',import.meta.url));
const {chromium}=require('playwright');
const out='outputs/free-agents-implementation';
await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});
const report=[];
const base='http://127.0.0.1:5173/test-fixtures/free-agents-mobile.html';
try {
 for(const width of [320,390,1280]) {
  const page=await browser.newPage({viewport:{width,height:900}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const audit=async(state)=>{
    const results=await page.evaluate(measureScript(),{minTarget:width<=768?44:32,numericRe:NUMERIC_RE.source,barControlSelector:BAR_CONTROL_SELECTOR,tableDeadZonePx:TABLE_DEAD_ZONE_PX,columnPackRatio:COLUMN_PACK_RATIO,gutterSelectors:GUTTER_EDGE_SELECTORS});
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
    report.push({width,state,overflow,results});
    const bad=results.filter(r=>!r.ok);if(overflow||bad.length)console.log(JSON.stringify({width,state,overflow,bad}));
  };
  const go=async(state='bid',extra='')=>{
    await page.goto(`${base}?state=${state}${extra}`,{waitUntil:'networkidle'});
    await page.locator('.fa-main').waitFor();
  };
  await go();await audit('bid');
  await page.screenshot({path:`${out}/a-${width}.png`,fullPage:width===1280});
  await page.getByRole('button',{name:'Open Josh Downs details',exact:true}).click();
  await audit('bid-sheet');await page.screenshot({path:`${out}/sheet-${width}.png`});
  await page.getByRole('spinbutton',{name:'Your bid',exact:true}).fill('10');
  assert.equal(await page.getByRole('button',{name:'Place bid',exact:true}).isEnabled(),false);
  await page.getByRole('spinbutton',{name:'Walk-away',exact:true}).fill('12');
  assert.equal(await page.getByRole('button',{name:'Place bid',exact:true}).isEnabled(),true);
  await page.getByRole('button',{name:'Place bid',exact:true}).click();
  await page.getByRole('dialog').waitFor({state:'detached'});
  assert.equal(await page.evaluate(()=>window.fixtureWrites[0].body.bid_amount),10);
  await page.getByRole('button',{name:'Open Josh Downs details',exact:true}).click();
  assert.equal(await page.getByRole('spinbutton',{name:'Walk-away',exact:true}).inputValue(),'12');
  await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);
  assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('aria-label')),'Open Josh Downs details');
  await page.getByRole('button',{name:'Search and filters',exact:true}).click();
  await page.getByRole('searchbox',{name:'Search players',exact:true}).fill('Spears');
  assert.equal(await page.locator('.fa-player').count(),1);
  await page.getByRole('button',{name:'Reset filters',exact:true}).click();
  await audit('filters');
  for(const state of ['claim','add','predraft','priority','readonly','loading','empty','missing','write-error','claim-error','market-error']) {
    await go(state);await audit(state);
    if(['claim','add'].includes(state)) {
      assert.doesNotMatch(await page.locator('.fa-main').innerText(),/\$|cap|bid|contract/i);
      await page.getByRole('button',{name:'Open Josh Downs details',exact:true}).click();await audit(state+'-sheet');
      assert.doesNotMatch(await page.getByRole('dialog').innerText(),/\$|cap|bid|contract/i);
      if(state==='claim') {
        await page.getByRole('button',{name:'Drop if successful: No conditional drop',exact:true}).click();
        await page.getByRole('option',{name:'Bench Player',exact:true}).click();
        await page.getByRole('button',{name:'Confirm claim',exact:true}).click();
        await page.getByRole('dialog').waitFor({state:'detached'});
        assert.equal(await page.evaluate(()=>window.fixtureWrites[0].body.claims[0].drop_player_id),'bench');
        await page.locator('.fa-claims-disclosure > summary').click();await audit('queued-claim');
        await page.getByRole('button',{name:'Cancel claim',exact:true}).click();
        assert.equal(await page.evaluate(()=>window.fixtureWrites.at(-1).body.claims.length),0);
      } else {
        await page.getByRole('button',{name:'Add player',exact:true}).click();
        await page.getByRole('dialog').waitFor({state:'detached'});
        assert.equal(await page.evaluate(()=>window.fixtureWrites[0].path),'/api/hub/roster');
      }
    }
    if(state==='predraft') {
      await page.getByRole('button',{name:'Add to draft watchlist: Josh Downs',exact:true}).click();
      assert.equal(await page.getByRole('button',{name:'Remove from draft watchlist: Josh Downs',exact:true}).getAttribute('aria-pressed'),'true');
      assert.equal(await page.getByRole('button',{name:'Add Josh Downs',exact:true}).isEnabled(),false);
    }
    if(state==='priority') {
      await page.getByRole('button',{name:'Confirm waiver order',exact:true}).click();
      assert.equal(await page.evaluate(()=>window.fixtureWrites[0].path),'/api/hub/fa-market/priority');
    }
    if(['write-error','claim-error'].includes(state)) {
      await page.getByRole('button',{name:'Open Josh Downs details',exact:true}).click();
      await page.getByRole('button',{name:state==='write-error'?'Place bid':'Confirm claim',exact:true}).click();
      await page.getByRole('alert').waitFor();
      assert.match(await page.getByRole('dialog').innerText(),/could not save/);
      await audit(state+'-sheet');
    }
    if(state==='missing') assert.equal(await page.locator('.fa-outlook strong').innerText(),'—');
    if(['readonly','market-error'].includes(state)) assert.equal(await page.locator('.fa-acquire').first().isEnabled(),false);
  }
  await go('bid','&long=1');await audit('long-names');
  await go('bid','&lowcap=1');await page.getByRole('button',{name:'Open Josh Downs details',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Place bid',exact:true}).isEnabled(),false);
  assert.match(await page.getByRole('dialog').innerText(),/exceeds your available cap/);
  await go('claim','&protected=1');assert.equal(await page.getByRole('button',{name:'Claim Josh Downs',exact:true}).isEnabled(),false);
  await go('large');
  if(width>768) {
    assert.ok(await page.locator('.fa-player').count()<100);
    await page.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));
    await page.getByRole('button',{name:'Open Player 239 details',exact:true}).waitFor();
    assert.ok(await page.locator('.fa-player').count()<100);await audit('virtualized-end');
  } else {
    assert.equal(await page.locator('.fa-player').count(),20);
    await page.getByRole('button',{name:'Show more players',exact:true}).click();
    assert.equal(await page.locator('.fa-player').count(),40);
  }
  assert.deepEqual(errors,[]);await page.close();
 }
} finally {await browser.close();await fs.writeFile(`${out}/audit.json`,JSON.stringify(report,null,2));}
const failures=report.filter(r=>r.overflow||r.results.some(x=>!x.ok));
console.log(JSON.stringify({checks:report.length,failures:failures.length}));
assert.equal(failures.length,0);
