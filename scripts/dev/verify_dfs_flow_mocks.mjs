// Run against the local mock-only server at 127.0.0.1:5174. No app/API requests.
import { chromium } from '../../frontend/node_modules/playwright/index.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const dir=new URL('../../docs/mockups/dfs-flow-review/',import.meta.url);
await mkdir(dir,{recursive:true});
const browser=await chromium.launch({headless:true});
const report=[];
try {
  for(const option of ['a','b','c']) {
    for(const width of [1280,390,320]) {
      const page=await browser.newPage({viewport:{width,height:width>500?900:844},reducedMotion:'reduce'});
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      const requests=[];
      await page.route('**/*',route=>{
        const url=new URL(route.request().url());requests.push(url.href);
        if(url.hostname!=='127.0.0.1'||url.port!=='5174'||url.pathname.startsWith('/api')) {
          errors.push('Unexpected non-mock request: '+url.href);return route.abort();
        }
        return route.continue();
      });
      await page.goto(`http://127.0.0.1:5174/dfs-flow-${option}.html`,{waitUntil:'networkidle'});
      assert.equal(await page.locator('main#main-content').count(),1);
      for(const theme of ['dark','light']) {
        await page.getByRole('combobox',{name:'Theme',exact:true}).click();
        await page.locator('#theme-picker-options').getByRole('option',{name:theme==='dark'?'Dark':'Light',exact:true}).click();
        const overflow=await page.evaluate(()=>Math.max(document.body.scrollWidth,document.documentElement.scrollWidth)>innerWidth+1);
        assert.equal(overflow,false,`${option}/${width}/${theme} overflow`);
        if(width!==320)await page.screenshot({path:fileURLToPath(new URL(`${option}-${width>500?'desktop':'phone'}${theme==='light'?'-light':''}.png`,dir)),fullPage:width>500});
      }
      await page.getByRole('combobox',{name:'Theme',exact:true}).click();
      await page.locator('#theme-picker-options').getByRole('option',{name:'Dark',exact:true}).click();
      // Menus support keyboard selection/dismissal.
      const theme=page.getByRole('combobox',{name:'Theme',exact:true});
      await theme.focus();await theme.press('ArrowDown');await page.keyboard.press('End');await page.keyboard.press('Enter');
      assert.equal(await page.getAttribute('body','data-theme'),'light');
      await theme.click();await page.keyboard.press('Escape');assert.equal(await theme.getAttribute('aria-expanded'),'false');
      if(option==='a')await page.locator('summary').filter({hasText:'Choose players'}).click();
      await page.getByRole('button',{name:'Lock J. Carter',exact:true}).click();
      assert.equal(await page.getByRole('button',{name:'Lock J. Carter',exact:true}).getAttribute('aria-pressed'),'true');
      await page.getByRole('button',{name:'Skip J. Carter',exact:true}).click();
      assert.equal(await page.getByRole('button',{name:'Lock J. Carter',exact:true}).getAttribute('aria-pressed'),'false');
      await page.locator('#player-search').fill('no match');assert.equal(await page.getByText('No matching players.',{exact:true}).count(),1);
      await page.locator('#player-search').fill('');
      if(width===320) {
        for(const detail of await page.locator('details').all()) {
          if(await detail.isVisible()&&!(await detail.getAttribute('open')!==null))await detail.locator(':scope > summary').click();
        }
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'expanded disclosures overflow');
        await page.screenshot({path:fileURLToPath(new URL(`${option}-320-advanced.png`,dir)),fullPage:true});
        await page.locator('.destination > span:first-child').evaluate(el=>el.textContent='NFL Daily Fantasy Sports Optimizer');
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'long destination overflow');
        assert.equal(await page.locator('.destination').evaluate(el=>el.getBoundingClientRect().height>=44),true);
      }
      await page.locator('[data-action=build]').click();
      assert.equal(await page.getByRole('heading',{name:'Your lineups',exact:true}).count(),1);
      await page.screenshot({path:fileURLToPath(new URL(`${option}-${width}-review.png`,dir)),fullPage:true});
      const sources=page.locator('summary').filter({hasText:'Build details'});await sources.focus();await sources.press('Enter');assert.equal(await sources.locator('..').getAttribute('open'),'');await sources.press('Enter');assert.equal(await sources.locator('..').getAttribute('open'),null);
      await page.getByRole('button',{name:'Continue to download',exact:true}).click();
      await page.getByRole('button',{name:'Preview sample entry file',exact:true}).click();
      assert.equal(await page.getByRole('button',{name:'Download entry-update CSV',exact:true}).isDisabled(),true);
      await page.locator('#start-check').check();assert.equal(await page.getByRole('button',{name:'Download entry-update CSV',exact:true}).isEnabled(),true);
      await page.getByRole('button',{name:'Download entry-update CSV',exact:true}).click();
      assert.match(await page.locator('#preview-toast').textContent(),/No entry file was created or submitted/);
      await page.evaluate(()=>scrollTo(0,document.body.scrollHeight));
      const cleared=await page.evaluate(()=>{const nav=document.querySelector('.phone-nav').getBoundingClientRect();const foot=document.querySelector('.footnote').getBoundingClientRect();return nav.height===0||foot.bottom<=nav.top;});assert.equal(cleared,true);
      assert.deepEqual(errors,[]);
      report.push({option,width,theme_checks:['dark','light'],workflow:'build/review/entry preview/check/download feedback passed',keyboard:'menus/disclosures passed',overflow:false,expanded_advanced_320:width===320,long_destination_320:width===320,network:'only local mock URLs; app API and remote requests blocked',request_count:requests.length,fixed_nav_clearance:true,page_errors:errors});
      await page.close();
    }
  }
}finally{await browser.close();}
await writeFile(new URL('interaction-report.json',dir),JSON.stringify({sample_data_only:true,report},null,2)+'\n');
console.log(JSON.stringify({passed:report.length,report},null,2));
