import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../../frontend/package.json',import.meta.url));
const {chromium}=require('playwright');
import {measureScript,NUMERIC_RE,BAR_CONTROL_SELECTOR,TABLE_DEAD_ZONE_PX,COLUMN_PACK_RATIO,GUTTER_EDGE_SELECTORS} from './layout_audit.mjs';
const base=process.env.HOME_PREVIEW_URL||'http://127.0.0.1:5173';
const out='outputs/mobile-home';
await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});
const reports=[];
async function audit(page,width,state){
 const rows=await page.evaluate(measureScript(),{minTarget:width<=768?44:32,numericRe:NUMERIC_RE.source,barControlSelector:BAR_CONTROL_SELECTOR,tableDeadZonePx:TABLE_DEAD_ZONE_PX,columnPackRatio:COLUMN_PACK_RATIO,gutterSelectors:GUTTER_EDGE_SELECTORS});
 const failed=rows.filter(r=>!r.ok);
 reports.push({width,state,route:'/hub/home',rows});
 assert.deepEqual(failed,[],`${state}@${width}: ${JSON.stringify(failed)}`);
}
try {
 for(const width of [390,1280]){
  const page=await browser.newPage({viewport:{width,height:900}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${base}/test-fixtures/mobile-home.html`);
  await page.getByText('112.4',{exact:true}).waitFor();
  assert.equal(await page.locator('.hub-home-next').count(),0);
  assert.equal(await page.getByText('Leftover for draft',{exact:true}).count(),0);
  assert.equal(await page.getByText('Needs attention',{exact:true}).count(),0);
  await audit(page,width,'season');
  await page.screenshot({path:`${out}/home-${width}.png`,fullPage:true});
  const chat=page.locator('.hub-home-chat > summary');
  if(width===390){
   assert.equal(await page.locator('.hub-home-chat').getAttribute('open'),null);
   await chat.click();
  }
  await page.getByLabel('Chat message').waitFor();
  await chat.focus();await page.keyboard.press('Enter');
  assert.equal(await page.getByLabel('Chat message').isVisible(),false);
  await page.keyboard.press('Enter');await page.getByLabel('Chat message').waitFor();
  await page.getByLabel('Chat message').fill('Ready for the week');
  await chat.click();await chat.click();
  assert.equal(await page.getByLabel('Chat message').inputValue(),'Ready for the week');
  await page.getByRole('button',{name:'Send',exact:true}).click();
  await page.waitForFunction(()=>window.__requests.some(r=>r.method==='POST'&&r.path.includes('/messages')));
  await page.getByText('Standings',{exact:true}).click();
  assert.equal(await page.locator('.hub-home-standing-list').isVisible(),true);
  await page.getByRole('button',{name:/Game center|Open This Week/}).filter({visible:true}).last().click();
  assert.deepEqual(await page.evaluate(()=>window.__navigation),{view:'game',extra:{matchupWeek:4}});
  if(width===390){
   const header=await page.locator('.app-header-mobile-top--league').boundingBox();assert.ok(header.height<=72);
   assert.equal(await page.locator('main .hub-league-context-bar').count(),0);
   await page.locator('.hub-league-context-caret > summary').click();
   const menu=await page.locator('.hub-league-context-caret-menu').boundingBox();assert.ok(menu.x>=0&&menu.x+menu.width<=width);
   await audit(page,width,'league-menu');
   await page.getByRole('button',{name:/Sunday league/}).click();
   await page.getByText('Sunday league',{exact:true}).first().waitFor();
   assert.equal(await page.locator('.hub-league-context-caret').getAttribute('open'),null);
   await page.locator('.hub-league-context-caret > summary').click();await page.keyboard.press('Escape');
   assert.equal(await page.locator('.hub-league-context-caret').getAttribute('open'),null);
   await page.getByRole('button',{name:'Home, choose destination',exact:true}).click();
   await page.getByRole('button',{name:'This Week',exact:true}).filter({visible:true}).click();
   assert.equal((await page.evaluate(()=>window.__navigation)).view,'week');
   await page.locator('.app-header-more').click();
   await page.getByRole('dialog').waitFor();await page.keyboard.press('Escape');
   assert.equal(await page.locator('#root').getAttribute('inert'),null);
  } else {
   const align=await page.locator('.hub-league-context-top').evaluate(e=>({left:e.getBoundingClientRect().left,control:e.querySelector('.hub-league-switcher').getBoundingClientRect().left}));
   assert.ok(Math.abs(align.left-align.control)<2);
  }
  assert.deepEqual(errors,[]);
  for(const state of ['pre','no-money','empty','error','loading','missing-projection','attention','staff']){
   await page.goto(`${base}/test-fixtures/mobile-home.html?state=${state}`);
   await page.locator('.hub-home-page').waitFor();
   if(state==='loading')await page.locator('.hub-home-card[aria-busy=true]').waitFor();
   else if(state==='error')await page.getByText('League unavailable',{exact:false}).first().waitFor();
   else if(['pre','no-money'].includes(state))await page.getByText('Fill 2 open seats.',{exact:true}).waitFor();
   else if(state==='empty')await page.getByText('Your matchup will appear when the schedule is ready.',{exact:true}).waitFor();
   else await page.locator('.hub-home-matchup').waitFor();
   if(state==='pre')assert.equal(await page.getByText('Leftover for draft',{exact:true}).isVisible(),true);
   if(state==='no-money')assert.equal(await page.getByText('Leftover for draft',{exact:true}).count(),0);
   if(state==='attention'){
    const order=await page.evaluate(()=>({chat:document.querySelector('.hub-home-chat').getBoundingClientRect().top,attention:document.querySelector('.hub-home-attention').getBoundingClientRect().top}));assert.ok(order.attention>order.chat);
   }
   await audit(page,width,state);
   await page.screenshot({path:`${out}/${state}-${width}.png`,fullPage:true});
  }
  await page.close();
  console.log(`Home ${width}: PASS layout and interactions across nine states`);
 }
 const small=await browser.newPage({viewport:{width:320,height:844}});
 await small.goto(`${base}/test-fixtures/mobile-home.html?long=1`);
 await small.getByText('112.4',{exact:true}).waitFor();
 await audit(small,320,'long-names');
 await small.locator('.hub-league-context-caret > summary').click();
 const box=await small.locator('.hub-league-context-caret-menu').boundingBox();assert.ok(box.x>=0&&box.x+box.width<=320);
 await audit(small,320,'long-names-menu');
 await small.screenshot({path:`out/long-320.png`.replace('out/',`${out}/`),fullPage:true});
 console.log('Home 320: PASS long league name and menu');
}finally{
 await fs.writeFile(`${out}/browser-report.json`,JSON.stringify(reports,null,2));
 await browser.close();
}
