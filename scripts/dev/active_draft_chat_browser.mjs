// Real active draft and compact chat components; all league HTTP/WebSockets isolated.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {attachDraftFixture,draftFixtureUrl} from './draft_fixture_runtime.mjs';
import {measureScript,minTargetForWidth,NUMERIC_RE,BAR_CONTROL_SELECTOR,TABLE_DEAD_ZONE_PX,COLUMN_PACK_RATIO,GUTTER_EDGE_SELECTORS} from './layout_audit.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const require=createRequire(path.join(root,'frontend/package.json')),{chromium}=require('playwright');
const out=path.join(root,'outputs/agent/release-regressions/active-draft-chat');await fs.mkdir(out,{recursive:true});
// Full room owns inline chat; never introduce a duplicate floating launcher.
assert.match(await fs.readFile(path.join(root,'frontend/src/DraftHub/DraftHub.jsx'),'utf8'),/hidden: !active \|\| subView === "room" \|\| createLeagueOpen/);
const browser=await chromium.launch({headless:true,channel:process.platform==='win32'?'msedge':undefined});
const specs=[];
for(const practice of [false,true])for(const width of [1280,390,320])for(const theme of ['dark','light'])for(const mode of ['bidding','nominating','paused','snake'])specs.push({practice,width,theme,mode});
for(const practice of [false,true])for(const width of [1280,390])for(const theme of ['dark','light'])for(const role of ['visitor','offline','member'])specs.push({practice,width,theme,mode:role==='offline'?'nominating':'bidding',role});
const report=[];
try{
for(const spec of specs.filter(s=>!process.argv.includes('--narrow')||(!s.practice&&s.width===320&&s.mode==='bidding'&&s.theme==='dark'&&!s.role))){
 const {practice,width,theme,mode,role}=spec,name=`${role||"commissioner"}-${practice?'mock':'native'}-${mode}-${width}-${theme}`;
 const context=await browser.newContext({viewport:{width,height:width===320?568:width===390?844:900},serviceWorkers:'block',reducedMotion:'reduce'});
 const errors=[],blocked=[],mediaFallbacks=[];let page;
 try{
  await context.route('**/*',r=>{const u=new URL(r.request().url());
   if(u.hostname==='a.espncdn.com'&&u.pathname==='/combiner/i'&&/^\/i\/teamlogos\/nfl\/500\/[a-z]+\.png$/.test(u.searchParams.get('img')||''))mediaFallbacks.push(u.href);else blocked.push(u.href);
   return r.abort();});
  await context.addInitScript(theme=>{localStorage.setItem('scoresense-color-theme',theme);localStorage.setItem('scoresense:draft-sound','0');},theme);
  await attachDraftFixture(context);page=await context.newPage();page.setDefaultTimeout(12000);
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(draftFixtureUrl+'?'+new URLSearchParams({shell:'1',state:mode==='snake'?'nominating':mode,format:mode==='snake'?'snake':'auction',practice:practice?'1':'0',role:role==='visitor'?'visitor':role==='member'?'member':'commissioner',offline:role==='offline'?'1':'0'}));
  await page.locator('.hub-draft-live-command').waitFor();
  if(role==='member'){assert.equal(await page.getByRole('button',{name:'Pause',exact:true}).count(),0,'member has no pause control');assert.equal(await page.getByRole('button',{name:/^Award now/}).count(),0,'member has no award control');}await page.evaluate(()=>document.fonts.ready);
  await page.getByRole('tab',{name:'Chat',exact:true}).click();
  const composer=page.getByRole('combobox',{name:'Chat message',exact:true});
  await composer.waitFor();if(role!=='visitor')await composer.fill('Unsent local draft preview');else assert.equal(await composer.isEnabled(),false,'visitor chat is read-only');
  await page.getByRole('button',{name:'Send',exact:true}).waitFor();
  await composer.scrollIntoViewIfNeeded();
  assert.equal(await page.locator('.fantasy-chat-launcher-a').count(),0,'active room hides duplicate bubble');
  assert.equal(await page.evaluate(()=>document.documentElement.classList.contains('has-fantasy-chat-launcher')),false,'no phantom bubble lane');
  const audit=()=>page.evaluate(measureScript(),{minTarget:minTargetForWidth(width),numericRe:NUMERIC_RE.source,barControlSelector:BAR_CONTROL_SELECTOR,tableDeadZonePx:TABLE_DEAD_ZONE_PX,columnPackRatio:COLUMN_PACK_RATIO,gutterSelectors:GUTTER_EDGE_SELECTORS});
  const layout=await audit();
  await fs.writeFile(path.join(out,name+'.json'),JSON.stringify(layout,null,2));
  await page.screenshot({path:path.join(out,name+'.png')});
  assert.deepEqual(layout.filter(r=>!r.ok),[],name+' layout');
  const clear=()=>page.locator('.chat-compose-tools').evaluate(el=>{
   const nav=document.querySelector('.app-bottom-nav'),r=el.getBoundingClientRect(),n=nav?.getBoundingClientRect();
   return {bottom:r.bottom,navTop:n?.top,clear:!n||getComputedStyle(nav).display==='none'||r.bottom<=n.top};
  });
  assert.equal((await clear()).clear,true,'composer controls clear bottom navigation');
  if(role!=='visitor'){for(const label of ['Mention a league manager','Add emoji']){
   await page.getByRole('button',{name:label,exact:true}).click();
   assert.equal((await clear()).clear,true,label+' preserves composer clearance');
   assert.deepEqual((await audit()).filter(r=>!r.ok),[],label+' expanded layout');
   const obscured=await page.locator('.chat-mention-picker button,.chat-compose-emoji button').evaluateAll(buttons=>buttons.filter(b=>{
    const r=b.getBoundingClientRect();return !b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));
   }).map(b=>b.getAttribute('aria-label')||b.textContent));
   assert.deepEqual(obscured,[],label+' options are unobscured');
   if(label==='Add emoji')await page.screenshot({path:path.join(out,name+'-emoji.png')});
  }
  if(!practice&&width===320&&theme==='dark'&&mode==='bidding'){
   const oldStyle=await page.addStyleTag({content:'.chat-thread.is-compact .chat-compose-emoji{position:absolute!important;}'});
   assert.ok(await page.locator('.chat-compose-emoji button').evaluateAll(bs=>bs.some(b=>{const r=b.getBoundingClientRect();return !b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})),'old absolute picker is obscured by the bid bar');
   await oldStyle.evaluate(e=>e.remove());
   await page.locator('.chat-compose-emoji').evaluate(e=>e.scrollIntoView({block:'end'}));
  }
  const emoji=page.getByRole('button',{name:'Insert 👍',exact:true});await emoji.click();
  assert.match(await composer.inputValue(),/👍/);
  await page.getByRole('button',{name:'Add emoji',exact:true}).click();
  await page.getByRole('button',{name:'Insert 👍',exact:true}).press('Escape');
  assert.equal(await page.locator('.chat-compose-emoji').count(),0,'Escape dismisses compact picker');
  assert.equal(await composer.evaluate(e=>e===document.activeElement),true,'Escape restores composition focus');
  await composer.fill('');}
  for(const label of ['Teams',mode==='snake'?'Pick log':'Activity']){await page.getByRole('tab',{name:label,exact:true}).click();}
  await page.getByRole('tab',{name:'Chat',exact:true}).click();await composer.waitFor();
  assert.deepEqual(await page.evaluate(()=>window.__draftFixture.writes.filter(r=>r.path!=='/api/hub/draft-room/enrichment')),[],'no league/chat writes');
  assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);
  if(!practice&&width===320&&theme==='dark'&&mode==='bidding'){
   await page.evaluate(()=>window.__draftFixture.publishNomination());
   await page.waitForFunction(()=>{const bar=document.querySelector('[data-top-actions]');return bar&&Math.abs(parseFloat(document.documentElement.style.getPropertyValue('--top-action-height'))-bar.getBoundingClientRect().height)<1;});
  }
  if(!practice&&width===390&&theme==='dark'&&mode==='bidding'&&!role){
   await page.goto(draftFixtureUrl+'?shell=1&state=bidding&duplicateChat=1');
   await page.locator('.fantasy-chat-bubble-a').waitFor();
   assert.equal(await page.locator('.fantasy-chat-bubble-a').count(),1,'negative control proves a working provider would render a duplicate bubble without suppression');
  }
  report.push({...spec,passed:true,mediaFallbacks});console.log('PASS',name);
 }catch(e){report.push({...spec,passed:false,error:e.message});console.log('FAIL',name,e.message);if(page)await page.screenshot({path:path.join(out,name+'-failure.png')});}
 finally{await context.close();await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));}
}
}finally{await browser.close();}
if(report.some(r=>!r.passed))process.exitCode=1;
console.log(`${report.filter(r=>r.passed).length}/${report.length} active draft chat scenarios passed`);
