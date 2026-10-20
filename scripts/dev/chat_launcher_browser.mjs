// Production chat/chrome and Trades fixtures. All APIs and external assets are isolated.
// Run from the repository root: node scripts/dev/chat_launcher_browser.mjs
import { chromium } from '../../frontend/node_modules/playwright/index.mjs';
import { build } from '../../frontend/node_modules/esbuild/lib/main.js';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { measureScript, auditHighlightInsets, NUMERIC_RE, BAR_CONTROL_SELECTOR, TABLE_DEAD_ZONE_PX, COLUMN_PACK_RATIO, GUTTER_EDGE_SELECTORS } from './layout_audit.mjs';

const folder='outputs/chat-launcher';
fs.mkdirSync(folder,{recursive:true});
const widths=process.argv.includes('--width')?[Number(process.argv[process.argv.indexOf('--width')+1])]:[320,390,1280];
const selected=process.argv.includes('--case')?process.argv[process.argv.indexOf('--case')+1]:null;
const cases=[
  {id:'chat-dark',fixture:'chat-launcher',interaction:'chat-anchor',query:{}},
  {id:'chat-light',fixture:'chat-launcher',interaction:'chat-anchor',query:{theme:'light'}},
  {id:'chat-reduced',fixture:'chat-launcher',interaction:'chat-anchor',query:{motion:'reduce'}},
  {id:'trades-salary',fixture:'trades-transfers',interaction:'chat-trades',query:{state:'salary',chat:'1'}},
  {id:'trades-pick',fixture:'trades-transfers',interaction:'chat-trades',query:{state:'pick',chat:'1'}},
].filter(spec=>!selected||spec.id===selected);
assert.ok(cases.length,'Requested case exists');
for(const fixture of new Set(cases.map(spec=>spec.fixture)))await build({
  entryPoints:[`frontend/test-fixtures/${fixture}.jsx`],bundle:true,jsx:'automatic',format:'esm',
  outfile:`${folder}/${fixture}.js`,external:['/art/*'],
  loader:{'.js':'jsx','.png':'dataurl','.svg':'dataurl','.webp':'dataurl','.woff2':'dataurl'},
  define:{'process.env.NODE_ENV':'"production"'},logLevel:'warning'
});
const clearanceRules=new Set(['chat-anchor','overlay-clearance','nav-clearance','action-nav-clearance','fixed-action-clearance']);
const settlePage=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
const reports=[];
const smoke=false;
const flush=()=>fs.writeFileSync(`${folder}/report.json`,JSON.stringify(reports,null,2));
try {
  for(const spec of cases)for(const width of widths){
    const {id,fixture}=spec, report={id,width,checks:[],errors:[],externalRequests:[]};
    reports.push(report);
    const context=await browser.newContext({viewport:{width,height:1000},reducedMotion:spec.query.motion||'no-preference'});
    const page=await context.newPage();
    page.on('pageerror',error=>report.errors.push(error.message));
    await page.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.origin==='http://chat.fixture'&&url.pathname==='/theme-init.js')return route.fulfill({contentType:'text/javascript',body:fs.readFileSync('frontend/public/theme-init.js')});
      if(url.origin==='http://chat.fixture'&&url.pathname.startsWith('/fixture/')){
        const name=url.pathname.split('/').at(-1);
        if(name===`${fixture}.js`||name===`${fixture}.css`)return route.fulfill({contentType:name.endsWith('.js')?'text/javascript':'text/css',body:fs.readFileSync(path.join(folder,name))});
        if(name==='index.html')return route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><script src="/theme-init.js"></script><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="${fixture}.css"></head><body><div id="root"></div><script type="module" src="${fixture}.js"></script></body></html>`});
      }
      report.externalRequests.push(url.origin+url.pathname);
      return route.abort();
    });
    try {
      await page.goto(`http://chat.fixture/fixture/index.html?${new URLSearchParams(spec.query)}`);
      await page.locator('.fantasy-chat-bubble-a').waitFor();
        if (spec.interaction === "chat-anchor") {
          if(spec.query.motion)await page.emulateMedia({reducedMotion:spec.query.motion});
          const launcher=page.locator('.fantasy-chat-launcher-a');
          const dock=()=>launcher.evaluate(el=>{const b=el.getBoundingClientRect();return {right:innerWidth-b.right,bottom:innerHeight-b.bottom,width:b.width,height:b.height};});
          await page.evaluate(()=>document.fonts.ready);
          await settlePage(page);
          const initial=await dock();
          const settled=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
          const checkDock=async label=>{
            await settled();
            const next=await dock();
            (report.dock_samples ||= []).push({state:label,...next});
            assert.ok(Math.abs(next.right-initial.right)<=1 && Math.abs(next.bottom-initial.bottom)<=1,`${label} must not move the chat launcher`);
          };
          for(const y of [350,850,1300,0]){
            await page.evaluate(y=>scrollTo(0,y),y);
            await checkDock(`scroll ${y}`);
          }
          await page.getByRole('button',{name:'Change matchup',exact:true}).click();
          await checkDock('long matchup selection');
          for(const name of ['Rules','Contracts','Trades']){
            await page.getByRole('button',{name:`${name} actions`,exact:true}).click();
            await page.waitForFunction(()=>document.querySelector('[data-bottom-actions]')?.dataset.bottomPosition);
            await page.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));
            await checkDock(`${name} actions`);
            let checks=await page.evaluate(measureScript(),{minTarget:width<=768?44:32,numericRe:NUMERIC_RE.source,barControlSelector:BAR_CONTROL_SELECTOR,tableDeadZonePx:TABLE_DEAD_ZONE_PX,columnPackRatio:COLUMN_PACK_RATIO,gutterSelectors:GUTTER_EDGE_SELECTORS});
            report.action_checks ||= []; report.action_checks.push({state:name,checks});
            assert.deepEqual(checks.filter(row=>clearanceRules.has(row.rule)&&!row.ok),[],`${name} leaves the chat lane clear`);
            await page.getByRole('button',{name:'Grow actions',exact:true}).click();
            await page.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));
            await checkDock(`grown ${name} actions`);
            if(!smoke && width===390){
              const screenshot=path.join(folder,`${id}-${width}-${name.toLowerCase()}-actions.png`);
              await page.screenshot({path:screenshot,fullPage:false,timeout:5000});
              (report.action_screenshots ||= []).push(screenshot);
            }
            await page.getByRole('button',{name:'Grow actions',exact:true}).click();
          }
          await page.getByRole('button',{name:'None actions',exact:true}).click();
          // Focus a flowing control deliberately placed behind the corner.
          const startedObscured=await page.evaluate(()=>{const b=document.querySelector('.fantasy-chat-bubble-a').getBoundingClientRect(),button=document.querySelectorAll('[data-page-row]')[20];const target=button.getBoundingClientRect().top+scrollY;scrollTo(0,target-b.top+8);const a=button.getBoundingClientRect(),covered=Math.min(a.right,b.right)>Math.max(a.left,b.left)&&Math.min(a.bottom,b.bottom)>Math.max(a.top,b.top);button.focus({preventScroll:true});return covered;});
          assert.equal(startedObscured,true,'the focus regression starts with a control behind chat');
          await checkDock('keyboard focus');
          const focusClear=await page.evaluate(()=>{const a=document.activeElement.getBoundingClientRect(),b=document.querySelector('.fantasy-chat-bubble-a').getBoundingClientRect();return Math.min(a.right,b.right)<=Math.max(a.left,b.left)||Math.min(a.bottom,b.bottom)<=Math.max(a.top,b.top);});
          assert.equal(focusClear,true,'focused controls scroll clear of the fixed bubble');
          await page.getByRole('button',{name:'Switch fixture league',exact:true}).click();
          await checkDock('league switch');
          await page.evaluate(()=>{window.fixtureUnread=99;document.dispatchEvent(new Event('visibilitychange'));});
          await page.locator('.fantasy-chat-unread-a').getByText('99',{exact:true}).waitFor();
          await checkDock('unread badge');
          await page.evaluate(()=>{window.fixtureAlert={id:'sample-alert',kind:'trade',title:'Trade update',body:'Sample notification',target:{view:'trades'}};document.dispatchEvent(new Event('visibilitychange'));});
          await page.locator('.site-alert-toast').waitFor();
          await checkDock('on-site alert');
          const alertClear=await page.evaluate(()=>{const a=document.querySelector('.site-alert-toast').getBoundingClientRect(),b=document.querySelector('.fantasy-chat-bubble-a').getBoundingClientRect();return a.bottom<=b.top;});
          assert.equal(alertClear,true,'on-site alerts clear the static chat corner');
          await page.getByRole('button',{name:'Dismiss notification',exact:true}).click();
          await page.locator('.fantasy-chat-bubble-a').click();
          await page.getByRole('dialog').waitFor();
          assert.equal(await launcher.isVisible(),false);
          await page.getByRole('button',{name:'Minimize chat',exact:true}).click();
          await checkDock('minimize');
          const bubble=page.locator('.fantasy-chat-bubble-a');
          await bubble.hover();await page.mouse.down();await page.waitForTimeout(650);await page.mouse.up();
          await page.getByRole('button',{name:'Hide chat bubble',exact:true}).waitFor();
          await checkDock('hold to hide');
          await page.getByRole('button',{name:'Hide chat bubble',exact:true}).click();
          assert.equal(await launcher.count(),0);
          await page.reload({waitUntil:'domcontentloaded'});
          assert.equal(await launcher.count(),0,'dismissal persists for the session');
          await page.getByRole('button',{name:/Notifications/}).click();
          await page.getByRole('button',{name:'Notification settings',exact:true}).click();
          await page.getByRole('switch',{name:'Show chat bubble',exact:true}).check();
          await page.getByRole('button',{name:'Close notifications',exact:true}).click();
          await bubble.waitFor();await checkDock('settings restore');
          await bubble.focus();await bubble.press('Delete');
          await page.getByRole('button',{name:'Hide chat bubble',exact:true}).waitFor();
          await page.keyboard.press('Escape');
          await page.waitForFunction(()=>document.activeElement?.matches('.fantasy-chat-bubble-a'));
          assert.equal(await bubble.evaluate(el=>el===document.activeElement),true);
          await page.getByRole('button',{name:'Toggle Home',exact:true}).click();
          assert.equal(await launcher.count(),0,'Home owns its conversation without a duplicate launcher');
          await page.getByRole('button',{name:'Toggle Home',exact:true}).click();
          await checkDock('return from Home');
          await page.evaluate(()=>scrollTo(0,0));
        } else if (spec.interaction === "chat-trades") {
          const launcher=page.locator('.fantasy-chat-launcher-a');
          await launcher.waitFor();
          const dock=()=>launcher.evaluate(el=>{const b=el.getBoundingClientRect();return {right:innerWidth-b.right,bottom:innerHeight-b.bottom};});
          await page.evaluate(()=>document.fonts.ready);await settlePage(page);
          const initial=await dock();
          await page.locator('.hub-trade-desk-bar').getByRole('button',{name:'Choose partner',exact:true}).click();
          await page.getByRole('dialog').getByRole('button',{name:/Jordan Davis/}).click();
          const columns=page.locator('.hub-trade-party-col');
          await columns.nth(0).getByRole('button',{name:/^Send Josh Allen to/}).click();
          if(width<=768)await page.locator('.hub-trade-phone-views').getByRole('button',{name:'You receive',exact:true}).click();
          await columns.nth(1).getByRole('button',{name:/^Get Josh Allen from/}).click();
          await page.waitForFunction(()=>window.fixtureWrites.some(item=>item.body.validate_only));
          await settlePage(page);
          const next=await dock();
          report.dock_samples=[initial,next];
          assert.deepEqual(next,initial,'selecting a populated trade preserves the chat corner');
          assert.ok((await page.evaluate(()=>window.fixtureWrites)).every(item=>item.body.validate_only),'fixture only validates the package');
          if(!smoke){report.dock_screenshot=path.join(folder,`${id}-${width}-dock.png`);await page.screenshot({path:report.dock_screenshot,fullPage:false,timeout:5000});}

        }

      await settlePage(page);
      report.checks=await page.evaluate(measureScript(),{minTarget:width<=768?44:32,numericRe:NUMERIC_RE.source,barControlSelector:BAR_CONTROL_SELECTOR,tableDeadZonePx:TABLE_DEAD_ZONE_PX,columnPackRatio:COLUMN_PACK_RATIO,gutterSelectors:GUTTER_EDGE_SELECTORS});
      report.checks.push(...await auditHighlightInsets(page));
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
      assert.equal(overflow,false,'No horizontal page overflow');
      assert.deepEqual(report.errors,[],'No runtime errors');
      assert.equal(report.externalRequests.some(url=>url.includes('/api/')),false,'No APIs escape the fixture');
      await page.screenshot({path:path.join(folder,`${id}-${width}.png`),fullPage:true});
      assert.deepEqual(report.checks.filter(row=>!row.ok),[],`${id} @ ${width} layout`);
      report.ok=true;
      console.log(`PASS ${id} @ ${width}`);
    }catch(error){report.ok=false;report.error=String(error.stack||error);await page.screenshot({path:path.join(folder,`${id}-${width}-failure.png`),fullPage:true}).catch(()=>{});throw error;}
    finally {flush();await context.close();}
  }
} finally {flush();await browser.close();}
console.log(`PASS ${reports.length} chat/Trades fixture cases; screenshots and reports: ${folder}`);
