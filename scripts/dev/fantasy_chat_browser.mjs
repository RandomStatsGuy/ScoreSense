import { chromium } from '../../frontend/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {measureScript,minTargetForWidth,NUMERIC_RE,BAR_CONTROL_SELECTOR,TABLE_DEAD_ZONE_PX,COLUMN_PACK_RATIO,GUTTER_EDGE_SELECTORS} from './layout_audit.mjs';

const out=new URL('../../docs/mockups/fantasy-chat-review/implementation/',import.meta.url);
await fs.mkdir(out,{recursive:true});
const base='http://127.0.0.1:5173';
// Optional: review the exact PR build through the existing local server.
const reviewDist=process.env.FANTASY_CHAT_DIST ? path.resolve(process.env.FANTASY_CHAT_DIST) : null;
const realContext=await (await fetch(base+'/api/hub/context')).json();
const browser=await chromium.launch({headless:true});
const report=[];
const audit=async(page,width,scene)=>{
 const results=await page.evaluate(measureScript(),{minTarget:minTargetForWidth(width),numericRe:NUMERIC_RE.source,barControlSelector:BAR_CONTROL_SELECTOR,tableDeadZonePx:TABLE_DEAD_ZONE_PX,columnPackRatio:COLUMN_PACK_RATIO,gutterSelectors:GUTTER_EDGE_SELECTORS});
 report.push({width,scene,results});
 console.log(JSON.stringify({width,scene,fail:results.filter(r=>!r.ok)}));
 if(scene!=='home')assert.deepEqual(results.filter(r=>!r.ok),[],`${scene} layout passes at ${width}`);
};
try {
 for(const width of [390,1280,320]) {
  const context=await browser.newContext({viewport:{width,height:width>768?900:844},serviceWorkers:reviewDist?'block':'allow'});
  if(reviewDist) await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.origin!==base || url.pathname.startsWith('/api/') || url.pathname.startsWith('/test-fixtures/')) return route.continue();
   const rel=request.resourceType()==='document'?'index.html':decodeURIComponent(url.pathname).replace(/^\/+/, '');
   const file=path.resolve(reviewDist,rel);
   if(!file.startsWith(reviewDist+path.sep))return route.abort();
   try {
    const body=await fs.readFile(file);
    const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'}[path.extname(file)]||'application/octet-stream';
    return route.fulfill({body,contentType:mime});
   } catch { return route.continue(); }
  });
  const page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const members=[{id:realContext.team_id,name:'Kheylub',team_name:'Fourth & Goal',is_staff:true,can_message:true}, {id:'jordan',name:'Jordan Davis',team_name:'Red Zone Renegades',is_staff:false,can_message:true}, {id:'casey',name:'Casey Moore',team_name:'Sunday Specialists',is_staff:false,can_message:true}];
  const at=new Date().toISOString();
  const messages={league:[{id:'m1',team_id:'jordan',owner_name:'Jordan Davis',created_at:at,body:'Anyone looking for a running back? Open to talking trades before Sunday.',mentions:[],reactions:[{emoji:'👀',count:2,mine:false}]},{id:'m2',team_id:realContext.team_id,owner_name:'Kheylub',created_at:at,body:'@Jordan Davis I’m interested. Let’s talk.',mentions:[{team_id:'jordan',name:'Jordan Davis'}],reactions:[]}],office:[], 'direct:jordan':[{id:'d1',team_id:'jordan',owner_name:'Jordan Davis',created_at:at,body:'Want to discuss a trade?',mentions:[],reactions:[]}]};
  const prefs={trade:true,direct:true,mention:true,league:false};
  let notification=[{id:'n1',kind:'trade',title:'New trade offer',body:'Jordan Davis sent you a trade to review.',created_at:at,read_at:null,target:{view:'trades',proposal_id:'test'}}];
  const unread={league:3,'direct:jordan':1};
  let failure=false, delay=0;
  await page.route('**/api/hub/**',async route=>{
   const url=new URL(route.request().url()),path=url.pathname,method=route.request().method();
   const payload=()=>route.request().postDataJSON();
   const reply=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
   if(path.endsWith('/chat/summary'))return reply({members,threads:Object.keys(messages).map(key=>({key,unread:unread[key]||0,latest:messages[key].at(-1)})),unread:Object.values(unread).reduce((a,b)=>a+b,0),notification_unread:notification.filter(n=>!n.read_at&&prefs[n.kind]).length,notifications:notification,preferences:prefs});
   if(path==='/api/hub/notifications/preferences'){if(method==='PUT')Object.assign(prefs,payload().preferences);return reply({preferences:prefs});}
   if(path.endsWith('/notifications/read')){const body=payload();notification=notification.map(n=>body.ids.includes(n.id)||body.through&&n.created_at<=body.through?{...n,read_at:at}:n);return reply({ok:true});}
   if(path.endsWith('/chat/read')){unread[payload().thread]=0;return reply({ok:true});}
   if(path.includes('/chat/thread/')){
    const thread=decodeURIComponent(path.split('/chat/thread/')[1]);
    if(failure)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({detail:'Chat is temporarily unavailable.'})});
    if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
    if(method==='POST'){const body=payload();const message={id:'sent-'+Date.now(),team_id:realContext.team_id,owner_name:'Kheylub',body:body.body,created_at:at,reactions:[],mentions:members.filter(m=>body.mentions.includes(m.id)).map(m=>({team_id:m.id,name:m.name}))};(messages[thread]||=[]).push(message);return reply({message});}
    return reply({messages:messages[thread]||[]});
   }
   if(path.endsWith('/reactions')){const id=path.split('/messages/')[1].split('/')[0],body=payload();const m=Object.values(messages).flat().find(m=>m.id===id);let r=m.reactions.find(r=>r.emoji===body.emoji);if(!r)m.reactions.push(r={emoji:body.emoji,count:0,mine:false});if(body.pressed!==r.mine)r.count+=body.pressed?1:-1;r.mine=body.pressed;m.reactions=m.reactions.filter(r=>r.count>0);return reply({message:m});}
   return route.continue();
  });
  const shot=async scene=>page.screenshot({path:fileURLToPath(new URL(`${width}-${scene}.png`,out))});
  await page.goto(base+'/hub/roster',{waitUntil:'networkidle'});
  const bubble=page.locator('.fantasy-chat-bubble-a');await bubble.waitFor({state:'visible'});
  assert.equal(await page.locator('.fantasy-chat-hide-a').count(),0);
  assert.equal(await page.locator('.fantasy-chat-unread-a').textContent(),'4');
  if(width<769){const nav=await page.locator('.app-bottom-nav').boundingBox(),b=await bubble.boundingBox();assert.ok(nav.y-b.y-b.height>=15&&nav.y-b.y-b.height<=18,'Bubble is 16px above navigation');}
  await shot('bubble');
  await bubble.click();await page.locator('.chat-message').first().waitFor();
  const box=await page.locator('.communication-window').boundingBox();
  console.log({width,box});await shot('chat');
  assert.ok(Math.abs(box.x+box.width/2-width/2)<2,'Centered horizontally');
  assert.ok(Math.abs(box.y+box.height/2-(width>768?900:844)/2)<2,'Centered vertically');
  assert.equal(await page.evaluate(()=>document.body.style.overflow),'hidden');
  await shot('chat');await audit(page,width,'chat');
  const composer=page.getByRole('combobox',{name:'Chat message'});
  await composer.fill('@Jo');await composer.press('Enter');
  assert.equal(await composer.inputValue(),'@Jordan Davis ');
  await composer.fill('@Jordan Davis let’s make a deal.');await composer.press('Enter');
  await page.locator('.chat-message-body').filter({hasText:'let’s make a deal.'}).waitFor();
  assert.equal(await composer.inputValue(),'');
  const reaction=page.getByRole('button',{name:'👀 · 2',exact:true});await reaction.click();
  await page.getByRole('button',{name:'👀 · 3 · selected',exact:true}).waitFor();
  await page.getByRole('button',{name:'👀 · 3 · selected',exact:true}).click();await reaction.waitFor();
  await page.getByRole('tab',{name:/Direct/}).click();await page.locator('.chat-direct-person').filter({hasText:'Jordan Davis'}).click();
  await page.locator('.chat-message-body').filter({hasText:'Want to discuss a trade?'}).waitFor();
  assert.equal(await page.locator('#communication-title').textContent(),'Jordan Davis');
  await shot('direct');
  await page.keyboard.press('Escape');await bubble.waitFor({state:'visible'});
  assert.equal(await bubble.evaluate(el=>document.activeElement===el),true,'Focus restored');
  const b=await bubble.boundingBox();await page.mouse.move(b.x+28,b.y+28);await page.mouse.down();await page.waitForTimeout(700);await page.mouse.up();
  await page.getByRole('button',{name:'Hide chat bubble',exact:true}).waitFor();assert.equal(await page.getByRole('dialog').count(),0);
  await page.getByRole('button',{name:'Hide chat bubble',exact:true}).click();assert.equal(await bubble.count(),0);
  const bell=page.locator('.notification-bell').filter({visible:true}).first();await bell.click();await page.getByRole('button',{name:'Notification settings',exact:true}).click();
  await page.getByRole('switch',{name:'Show chat bubble',exact:true}).check();
  await page.getByRole('switch',{name:'Direct messages',exact:true}).uncheck();await page.waitForTimeout(100);
  await shot('settings');await audit(page,width,'settings');
  await page.keyboard.press('Escape');await bubble.waitFor({state:'visible'});
  // Reload confirms account preferences and session dismissal persistence.
  await page.reload({waitUntil:'networkidle'});await bubble.waitFor({state:'visible'});
  await bell.click();await page.getByRole('button',{name:'Notification settings',exact:true}).click();assert.equal(await page.getByRole('switch',{name:'Direct messages',exact:true}).isChecked(),false);
  await page.keyboard.press('Escape');await bell.click();await shot('notifications');await audit(page,width,'notifications');
  await page.getByRole('button',{name:'Mark all read',exact:true}).click();await page.waitForTimeout(100);assert.equal(await page.locator('.notification-dot').count(),0);
  await page.keyboard.press('Escape');
  // Foreground poll discovers alerts; normal league activity only counts on bubble.
  unread.league=1;notification.unshift({id:'n2',kind:'league',title:'New league message',body:'Hello league',created_at:at,target:{thread:'league'}});
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await page.waitForTimeout(200);assert.equal(await page.locator('.site-alert-toast').count(),0);
  notification.unshift({id:'n3',kind:'trade',title:'Trade accepted',body:'Your trade has a new response.',created_at:at,target:{view:'trades'}});
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await page.locator('.site-alert-toast').waitFor();await shot('toast');await page.getByRole('button',{name:'Dismiss notification'}).click();
  failure=true;await bubble.click();await page.getByRole('alert').filter({hasText:'temporarily unavailable'}).waitFor();await shot('error');
  failure=false;await page.getByRole('button',{name:'Retry',exact:true}).click();await page.locator('.chat-message').first().waitFor();
  await composer.fill('Keep this draft if sending fails.');failure=true;await composer.press('Enter');await page.getByRole('alert').filter({hasText:'temporarily unavailable'}).waitFor();assert.equal(await composer.inputValue(),'Keep this draft if sending fails.');failure=false;
  await page.getByRole('tab',{name:'Staff',exact:true}).click();await page.getByText('No messages yet — say hello.').waitFor();await shot('empty');
  await page.keyboard.press('Escape');delay=700;await bubble.click();await page.locator('.chat-loading').waitFor();await shot('loading');await page.locator('.chat-message').first().waitFor();delay=0;
  await page.evaluate(()=>window.scoreSenseTheme.set('light'));await shot('chat-light');
  await page.keyboard.press('Escape');if(!reviewDist){await page.goto(base+'/hub/home',{waitUntil:'networkidle'});const homeChat=page.locator('.hub-home-locker,.hub-home-chat').first();await homeChat.waitFor();if(await homeChat.evaluate(el=>el.tagName==='DETAILS'&&!el.open))await homeChat.locator('summary').first().click();await homeChat.locator('.chat-message').first().waitFor();assert.equal(await bubble.count(),0,'Home houses the thread without a duplicate bubble');await shot('home');await audit(page,width,'home');}
  if(width<769){await page.goto(base+'/hub/rules',{waitUntil:'networkidle'});await page.locator('.hub-rules-sticky-save').scrollIntoViewIfNeeded();await page.waitForTimeout(150);const action=await page.locator('.hub-rules-sticky-save').boundingBox(),b=await bubble.boundingBox();assert.ok(b.y+b.height<=action.y-15,'Bubble clears the Rules save action');await shot('rules-clearance');}
  if(!reviewDist) {
   await page.goto(base+`/test-fixtures/fantasy-chat.html?compact=1&team=${realContext.team_id}`,{waitUntil:'networkidle'});await page.locator('.chat-message').first().waitFor();assert.equal(await page.getByRole('tab').count(),0);await shot('draft-component');await audit(page,width,'draft-component');
   await page.goto(base+`/test-fixtures/fantasy-chat.html?team=${realContext.team_id}`,{waitUntil:'networkidle'});await page.locator('.chat-message').first().waitFor();assert.equal(await page.getByRole('tab',{name:'Staff'}).count(),0);assert.equal(await page.locator('.chat-admin-menu').count(),0,'Regular members cannot clear or open staff chat');await audit(page,width,'member');
  }
  assert.deepEqual(errors,[]);
  console.log(`INTERACTIONS PASS ${width}`);
  await context.close();
 }
} catch(error) { console.error(error);await fs.writeFile(new URL('failure.txt',out),String(error.stack));throw error; }
finally {await fs.writeFile(new URL('layout-checks.json',out),JSON.stringify(report,null,2));await browser.close();}
