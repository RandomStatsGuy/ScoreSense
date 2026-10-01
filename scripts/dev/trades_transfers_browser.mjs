// Run from the repository root. Fixtures intercept every league request.
import { chromium } from '../../frontend/node_modules/playwright/index.mjs';
import { build } from '../../frontend/node_modules/esbuild/lib/main.js';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { measureScript, NUMERIC_RE, BAR_CONTROL_SELECTOR, TABLE_DEAD_ZONE_PX, COLUMN_PACK_RATIO, GUTTER_EDGE_SELECTORS } from './layout_audit.mjs';

await build({entryPoints:['frontend/test-fixtures/trades-transfers.jsx'],bundle:true,jsx:'automatic',format:'esm',outfile:'outputs/trades-fixture/trades.js',external:['/art/*'],loader:{'.js':'jsx','.png':'dataurl','.svg':'dataurl','.webp':'dataurl','.woff2':'dataurl'},define:{'process.env.NODE_ENV':'"production"'}});
const browser = await chromium.launch({headless:true,channel:'msedge'});
const reports=[];
try {
  for (const width of [1280,390]) {
    const page = await browser.newPage({viewport:{width,height:900}});
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/theme-init.js',route=>route.fulfill({contentType:'text/javascript',body:fs.readFileSync('frontend/public/theme-init.js','utf8')}));
    await page.route('**/__trade_qa/**',async route=>{
      const url=new URL(route.request().url());
      const file=url.pathname.endsWith('.js')?'trades.js':url.pathname.endsWith('.css')?'trades.css':null;
      await route.fulfill({contentType:file?.endsWith('.js')?'text/javascript':file?'text/css':'text/html',body:file?fs.readFileSync('outputs/trades-fixture/'+file):'<html><head><script src="/theme-init.js"></script><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="trades.css"></head><body><div id="root"></div><script type="module" src="trades.js"></script></body></html>'});
    });
    const open = state=>page.goto(`http://127.0.0.1:5173/__trade_qa/index.html?state=${state}`);
    await open('salary');
    await page.locator('.ss-trade-rank-strong').first().waitFor();
    await page.screenshot({path:`outputs/trades-discovery-${width}.png`,fullPage:true});
    await page.getByRole('button',{name:/Trade with Jordan Davis/}).click();
    await page.getByText('Multi-team trade',{exact:true}).click();
    await page.getByRole('button',{name:/Add Morgan Lee/}).click();
    const cols=page.locator('.hub-trade-party-col');
    assert.equal(await cols.count(),3);
    for (const [index,recipient] of ['Jordan Davis · Sunday Rivals','Morgan Lee · Mountain Kings','Maya Chen · Sunday Roster'].entries()) {
      await cols.nth(index).getByRole('button',{name:'Send Josh Allen to: Choose recipient',exact:true}).click();
      await page.getByRole('option',{name:recipient,exact:true}).click();
    }
    await cols.nth(0).getByRole('button',{name:'Send Former Player to: Choose recipient',exact:true}).click();
    await page.getByRole('option',{name:'Morgan Lee · Mountain Kings',exact:true}).click();
    await page.getByRole('spinbutton',{name:'Dead cap to move from Former Player',exact:true}).fill('10');
    await page.waitForFunction(()=>window.fixtureWrites.at(-1)?.body.parties?.[0]?.dead_cap_transfers?.[0]?.amount===10);
    const body=await page.evaluate(()=>window.fixtureWrites.at(-1).body);
    assert.deepEqual(body.parties.map(p=>p.sends[0].to_team_id),['team1','team2','mine']);
    assert.equal(body.parties[0].dead_cap_transfers[0].to_team_id,'team2');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No horizontal overflow');
    await page.screenshot({path:`outputs/trades-transfers-${width}.png`,fullPage:true});
    const checks=await page.evaluate(measureScript(),{minTarget:width===390?44:32,numericRe:NUMERIC_RE.source,barControlSelector:BAR_CONTROL_SELECTOR,tableDeadZonePx:TABLE_DEAD_ZONE_PX,columnPackRatio:COLUMN_PACK_RATIO,gutterSelectors:GUTTER_EDGE_SELECTORS});
    assert.deepEqual(checks.filter(x=>!x.ok),[]);
    reports.push({width,checks});

    await open('sleeper');
    await page.getByRole('button',{name:/Inbox/}).click();
    await page.getByRole('button',{name:'Apply agreed cap terms',exact:true}).click();
    await page.waitForFunction(()=>window.fixtureWrites.some(x=>x.path.endsWith('/settle')));
    await page.waitForFunction(()=>window.fixtureRequests.filter(x=>x.includes('/rosters')).length>=2);
    assert.equal(await page.getByRole('button',{name:'Force apply',exact:true}).count(),0);
    await open('review');
    await page.getByRole('button',{name:/Inbox/}).click();
    await page.getByRole('button',{name:'Add dead-cap terms',exact:true}).click();
    assert.equal(await page.getByRole('button',{name:'Cut',exact:true}).count(),0);
    await page.getByRole('button',{name:'Send Former Player to: Choose recipient',exact:true}).click();
    await page.getByRole('option',{name:'Jordan Davis · Sunday Rivals',exact:true}).click();
    await page.getByRole('spinbutton',{name:'Dead cap to move from Former Player',exact:true}).fill('10');
    await page.waitForFunction(()=>window.fixtureWrites.at(-1)?.body.parties?.[0]?.dead_cap_transfers?.[0]?.amount===10);
    await page.getByRole('button',{name:/Review trade/}).click();
    await page.getByRole('button',{name:/Propose trade/}).click();
    await page.waitForFunction(()=>window.fixtureWrites.some(x=>x.body.source_review_id==='sleeper-proposal'));
    const reviewBody=await page.evaluate(()=>window.fixtureWrites.find(x=>x.body.source_review_id)?.body);
    assert.ok(reviewBody.parties.every(p=>p.sends.length===0 && p.drops.length===0));
    assert.equal(reviewBody.parties[0].dead_cap_transfers[0].amount,10);
    for (const state of ['empty','loading','error','readonly','pick','missing']) {
      await open(state);
      await page.locator('.draft-hub').waitFor();
      await page.waitForTimeout(200);
      const text=await page.locator('body').innerText();
      if (state==='empty') assert.match(text,/No other managers in this league/);
      if (state==='error') assert.match(text,/Roster service unavailable/);
      if (state==='pick') assert.ok(!text.includes('$'),'Pick leagues omit cap money');
      if (state==='readonly') assert.equal(await page.evaluate(()=>window.fixtureWrites.length),0);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${state}: no horizontal overflow`);
    }
    assert.deepEqual(errors,[]);
    console.log(`${width}: layout, three-way routing, partial dead cap, Sleeper settlement and review PASS`);
    await page.close();
  }
  fs.writeFileSync('outputs/trades-layout.json',JSON.stringify(reports,null,2));
} finally { await browser.close(); }
