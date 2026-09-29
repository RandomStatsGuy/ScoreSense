/** Production weekly components; fixture writes stay in memory. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import {measureScript,NUMERIC_RE,BAR_CONTROL_SELECTOR,TABLE_DEAD_ZONE_PX,COLUMN_PACK_RATIO,GUTTER_EDGE_SELECTORS} from './layout_audit.mjs';
const require=createRequire(new URL('../../frontend/package.json',import.meta.url));
const {chromium}=require('playwright');
const base=process.env.WEEKLY_FIXTURE_URL || 'http://127.0.0.1:5173/test-fixtures/weekly-experience.html';
const out='outputs/mobile-week';await fs.mkdir(out,{recursive:true});
const report=[];const browser=await chromium.launch({headless:true});
async function audit(page,width,state){
 const results=await page.evaluate(measureScript(),{minTarget:width<=768?44:32,numericRe:NUMERIC_RE.source,barControlSelector:BAR_CONTROL_SELECTOR,tableDeadZonePx:TABLE_DEAD_ZONE_PX,columnPackRatio:COLUMN_PACK_RATIO,gutterSelectors:GUTTER_EDGE_SELECTORS});
 report.push({width,state,results});assert.deepEqual(results.filter(r=>!r.ok),[],JSON.stringify({width,state,failures:results.filter(r=>!r.ok)}));
}
try {for(const width of [390,1280]) {
 const page=await browser.newPage({viewport:{width,height:900}});page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('https://**/*',r=>r.abort());
 const open=async(query='')=>{await page.goto(base+query);await page.getByRole('button',{name:'Next week',exact:true}).waitFor();};
 const flex=()=>page.getByRole('button',{name:'Change FLEX: Jaylen Waddle',exact:true});
 const bench=()=>page.locator('.hub-wcc-bench > summary');
 const benchSmith=()=>page.getByRole('button',{name:'Start DeVonta Smith: choose a slot',exact:true});
 const writes=()=>page.evaluate(()=>window.fixtureWrites);
 await open('?week=3');await flex().waitFor();
 assert.equal(await page.getByRole('button',{name:'Lineup',exact:true}).getAttribute('aria-pressed'),'true');
 assert.match(await page.locator('.hub-week-forecast').innerText(),/76.0\s+—\s+71.0/);
 await audit(page,width,'lineup');await page.screenshot({path:`${out}/week-${width}.png`,fullPage:true});
 await flex().click();await page.getByRole('radio',{name:'DeVonta Smith',exact:true}).click();assert.equal((await writes()).length,0);
 await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal((await writes()).length,0);
 await bench().click();assert.equal(await page.locator('.hub-wcc-bench .hub-wcc-position-button').count(),3);
 await audit(page,width,'bench-open');await page.screenshot({path:`${out}/bench-${width}.png`,fullPage:true});
 await benchSmith().click();assert.deepEqual(await page.getByRole('radio').evaluateAll(els=>els.map(el=>el.getAttribute('aria-label'))),['WR: CeeDee Lamb','FLEX: Jaylen Waddle']);
 await page.getByRole('radio',{name:'FLEX: Jaylen Waddle',exact:true}).click();assert.equal((await writes()).length,0);
 await audit(page,width,'bench-picker');await page.screenshot({path:`${out}/picker-${width}.png`});
 await page.keyboard.press('Escape');assert.equal(await benchSmith().evaluate(el=>el===document.activeElement),true);
 await benchSmith().click();await page.getByRole('radio',{name:'FLEX: Jaylen Waddle',exact:true}).click();
 await page.getByRole('button',{name:'Start DeVonta Smith at FLEX',exact:true}).click();
 await page.getByRole('button',{name:'Change FLEX: DeVonta Smith',exact:true}).waitFor();
 const saved=await writes();assert.equal(saved.length,1);assert.equal(saved[0].body.week,3);assert.equal(saved[0].body.bench_player_id,'smith');assert.equal(saved[0].body.starter_player_id,'waddle');
 await page.waitForFunction(()=>document.querySelector('.hub-week-forecast')?.textContent.includes('78.5'));
 await page.getByRole('button',{name:'Correct a lineup',exact:true}).click();assert.deepEqual(await page.evaluate(()=>[window.fixtureDestination,window.fixtureNavigationExtra]),['office-corrections',{week:3}]);
 await page.getByRole('button',{name:'Next week',exact:true}).click();await page.waitForFunction(()=>window.fixtureRequests.some(x=>x.includes('/api/hub/week?week=4')));await page.getByRole('heading',{name:'Your starters',exact:true}).waitFor();
 assert.ok((await page.evaluate(()=>window.fixtureRequests)).some(path=>path.includes('live-scoring')&&path.includes('week=4')));
 assert.equal(await page.getByRole('button',{name:'Next week',exact:true}).count(),1);
 await page.getByRole('button',{name:'Matchup',exact:true}).click();await audit(page,width,'matchup');
 await page.getByRole('button',{name:'League',exact:true}).click();await page.getByText('Sam',{exact:true}).waitFor();await audit(page,width,'league');
 await open('?state=linked');await flex().waitFor();
 const sleeper=page.getByRole('link',{name:'Manage in Sleeper',exact:false});await sleeper.waitFor();assert.equal(await page.locator('header').filter({hasText:'Sleeper'}).count(),0);
 assert.ok(await sleeper.evaluate(el=>el.getBoundingClientRect().top>=document.querySelector('.hub-wcc-board').getBoundingClientRect().bottom));
 await audit(page,width,'linked');await page.screenshot({path:`${out}/sleeper-${width}.png`,fullPage:true});
 await bench().click();await benchSmith().click();await page.getByRole('radio',{name:'FLEX: Jaylen Waddle',exact:true}).click();await page.getByRole('link',{name:'Set lineup in Sleeper',exact:true}).waitFor();assert.equal((await writes()).length,0);await audit(page,width,'linked-picker');
 await open('?state=empty');await bench().click();await benchSmith().click();await page.getByRole('radio',{name:'FLEX: Empty',exact:true}).click();await page.getByRole('button',{name:'Start DeVonta Smith at FLEX',exact:true}).click();await page.getByRole('button',{name:'Change FLEX: DeVonta Smith',exact:true}).waitFor();assert.ok((await writes())[0].body.starters.some(s=>s.player_id==='smith'&&s.slot==='FLEX'));
 await open('?state=calls');await flex().waitFor();
 assert.equal(await page.getByText('1 lineup call',{exact:true}).count(),1);
 await audit(page,width,'calls');await page.screenshot({path:`${out}/calls-${width}.png`});
 await page.getByRole('button',{name:'Start Smith (+2.5)',exact:true}).click();await page.getByRole('dialog').waitFor();assert.equal((await writes()).length,0);await page.keyboard.press('Escape');
 await open('?state=write-error');await flex().waitFor();await bench().click();await benchSmith().click();await page.getByRole('radio',{name:'FLEX: Jaylen Waddle',exact:true}).click();await page.getByRole('button',{name:'Start DeVonta Smith at FLEX',exact:true}).click();await page.getByRole('alert').filter({hasText:'Game started'}).waitFor();assert.equal(await page.getByRole('dialog').count(),1);assert.match(await page.locator('.hub-week-forecast').innerText(),/76.0/);
 for(const state of ['readonly','locked-player','locked-starter']){
  await open(`?state=${state}&member=1`);await flex().waitFor();await bench().click();await benchSmith().click();
  if(state==='locked-starter')assert.equal(await page.getByRole('radio',{name:/FLEX: Jaylen Waddle/}).isEnabled(),false);
  else assert.equal(await page.getByRole('radio').first().isEnabled(),false);
  assert.equal((await writes()).length,0);await audit(page,width,state);
 }
 for(const state of ['missing','score-error','load-error','loading','no-roster','live']){
  await open(`?state=${state}&member=1`);
  if(state==='loading')await page.locator('.hub-loading-skeleton').waitFor();
  else if(state==='load-error')await page.getByRole('button',{name:'Retry',exact:true}).waitFor();
  else if(state==='no-roster')await page.getByRole('button',{name:'Lock a night',exact:true}).waitFor();
  else await flex().waitFor();
  if(state==='missing')assert.match(await page.locator('.hub-week-forecast > strong').innerText(),/^—\s+—\s+71.0/);
  if(state==='score-error')assert.match(await page.locator('body').innerText(),/Matchup unavailable/);
  if(state==='live')assert.equal(await page.getByRole('button',{name:'Lineup',exact:true}).getAttribute('aria-pressed'),'true');
  await audit(page,width,state);
 }
 for(const state of ['native-progress','final','specialists']) {
  await open(`?state=${state}&member=1`);await flex().waitFor();
  if(state==='specialists') {
   assert.match(await page.locator('.hub-week-forecast').innerText(),/84.4\s+—\s+71.0/);
   assert.match(await page.locator('.hub-week-forecast').innerText(),/K\/DEF use season estimates/);
  } else {
   assert.match(await page.locator('.hub-week-forecast').innerText(),state==='final'?/Final/:/Week in progress/);
   assert.equal(await page.getByRole('button',{name:'Lineup',exact:true}).getAttribute('aria-pressed'),'true');
   if(state==='final') {
    await bench().click();await benchSmith().click();
    assert.equal(await page.getByRole('radio').first().isEnabled(),false);
    assert.equal((await writes()).length,0);await page.keyboard.press('Escape');
   }
  }
  await audit(page,width,state);
 }
 await open('?matchupTeam=other');await page.getByRole('button',{name:'Matchup',exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Lineup',exact:true}).count(),0);assert.equal(await flex().count(),0);assert.equal((await writes()).length,0);
 for(const salary of [false,true]){
  await open(salary ? '?salary=1&member=1' : '?member=1');await flex().waitFor();
  if(width===390)await page.locator('.app-header-mobile-title-btn').click();
  else await page.getByRole('button',{name:'League navigation',exact:true}).click();
  const cap=page.getByRole(width===390?'button':'link',{name:'Cap',exact:true});
  assert.equal(await cap.count(),salary?1:0);
  assert.equal(await page.getByRole('link',{name:'Roster management',exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:'Roster management',exact:true}).count(),0);
 }
 assert.deepEqual(errors,[]);console.log(`PASS ${width}: starter/bench swaps, empty-slot fill, cancel/focus, locks, errors, Sleeper, week, lineup/matchup/league, responsive layout`);await page.close();
}
const small=await browser.newPage({viewport:{width:320,height:900}});await small.goto(base+'?long=1');await small.getByRole('heading',{name:'Your starters',exact:true}).waitFor();await audit(small,320,'long-names');await small.screenshot({path:`${out}/week-320.png`,fullPage:true});await small.close();
} finally {await fs.writeFile(`${out}/browser-report.json`,JSON.stringify(report,null,2));await browser.close();}
