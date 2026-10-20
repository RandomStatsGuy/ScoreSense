// Real DOM regression checks for table-audit geometry. No app/API is required.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { auditRoute, auditHighlightInsets, measureScript, NUMERIC_RE, BAR_CONTROL_SELECTOR, TABLE_DEAD_ZONE_PX, COLUMN_PACK_RATIO, GUTTER_EDGE_SELECTORS } from "./layout_audit.mjs";
const require = createRequire(new URL("../../frontend/package.json", import.meta.url));
const { chromium } = require("playwright");
const channel = process.env.PLAYWRIGHT_CHANNEL || (process.platform === "win32" ? "msedge" : undefined);
const browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}) });
try {
  const page = await browser.newPage();
  await page.route("**/*", route => route.abort());
  await page.setContent(`<style>
    table { border-collapse:collapse; width:auto; font:16px Arial; }
    th,td { padding:8px 12px; text-align:left; }
    .num { text-align:right; } .pos { text-align:center; }
    .group { text-align:center; } .wide { min-width:200px; }
  </style>
  <table id="grouped"><thead><tr><th>Player</th><th class="group" colspan="2">2026</th></tr>
  <tr><th>Player</th><th class="num">Salary</th><th class="num">Left</th></tr></thead><tbody>
  <tr><td>Long player name</td><td class="num">$9</td><td class="num">$2</td></tr>
  <tr><td colspan="2">Team total</td><td class="num">$2</td></tr></tbody></table>
  <table id="missing"><thead><tr><th>Player</th><th>Last sync</th><th class="pos">Pos</th></tr></thead>
  <tbody><tr><td>Alex</td><td>—</td><td class="pos">WR/TE</td></tr><tr><td>Jo</td><td>—</td><td class="pos">—</td></tr></tbody></table>
  <table id="loading"><thead><tr><th><div class="table-skeleton-cell"></div></th><th><div class="table-skeleton-cell"></div></th></tr></thead>
  <tbody class="table-skeleton"><tr><td>Placeholder</td><td>Placeholder</td></tr></tbody></table>
  <table id="empty"><thead><tr><th>Player</th><th class="wide">Paid</th></tr></thead><tbody></tbody></table>
  <table id="span-empty"><thead><tr><th class="num wide">#</th><th>Player</th></tr></thead>
  <tbody><tr><td colspan="2">No players match this filter.</td></tr></tbody></table>
  <table id="span-loading"><thead><tr><th class="num wide">#</th><th>Player</th></tr></thead>
  <tbody><tr><td colspan="2"><div class="hub-loading-skeleton" aria-busy="true">Building the board</div></td></tr></tbody></table>
  <table id="cards" style="display:block"><tbody><tr style="display:grid;grid-template-columns:1fr 1fr"><td>Sample manager</td><td class="wide">—</td></tr></tbody></table>`);
  const measure = () => page.evaluate(measureScript(), { minTarget:32, numericRe:NUMERIC_RE.source, barControlSelector:BAR_CONTROL_SELECTOR,
    tableDeadZonePx:TABLE_DEAD_ZONE_PX, columnPackRatio:COLUMN_PACK_RATIO, gutterSelectors:GUTTER_EDGE_SELECTORS });
  assert.deepEqual((await measure()).filter(row => row.rule === "tables" && !row.ok), [], "grouped headers, padding, totals and missing timestamps align correctly; full-span empty/loading tables have no data columns to measure");
  await page.locator("#grouped tbody tr").first().locator("td").nth(1).evaluate(el => { el.style.textAlign = "left"; });
  assert.ok((await measure()).some(row => row.rule === "tables" && !row.ok && row.detail.includes("align≠right")), "a real numeric misalignment still fails");
  await page.locator("#grouped tbody tr").first().locator("td").nth(1).evaluate(el => { el.style.textAlign = "right"; el.classList.add("wide"); });
  assert.ok((await measure()).some(row => row.rule === "tables" && !row.ok && row.detail.includes("content")), "a real overwide numeric column still fails");
  await page.setContent('<div id="background" inert><button class="btn-primary">Background action</button></div><div role="dialog" aria-modal="true"><button class="btn-primary">Confirm action</button></div>');
  assert.equal((await measure()).some(row=>row.rule==="primaries"&&!row.ok),false,"Inert background actions do not compete with the active dialog");
  await page.locator("#background").evaluate(el=>{el.inert=false;});
  assert.equal((await measure()).some(row=>row.rule==="primaries"&&!row.ok),true,"Two actionable primaries still fail");
  await page.setContent('<style>.hub-toolbar {display:flex;flex-direction:column;align-items:flex-start;padding:8px;gap:8px} button {margin:0;padding:0;width:160px;min-height:32px} #primary {height:38px}</style><div class="hub-toolbar"><button id="primary">Continue</button><button>Browse</button></div>');
  assert.equal((await measure()).some(row=>row.rule==="bars"&&!row.ok),false,"Stacked actions retain their approved control tiers");
  await page.locator(".hub-toolbar").evaluate(el=>{el.style.flexDirection="row";});
  assert.equal((await measure()).some(row=>row.rule==="bars"&&!row.ok&&row.detail.includes("control heights")),true,"Unequal controls in one horizontal row still fail");
  await page.setViewportSize({width:390,height:900});
  await page.locator(".hub-toolbar").evaluate(el=>{el.style.flexDirection="column";});
  assert.equal((await page.evaluate(measureScript(),{minTarget:44,numericRe:NUMERIC_RE.source,barControlSelector:BAR_CONTROL_SELECTOR})).some(row=>row.rule==="targets"&&!row.ok),true,"Stacking does not exempt undersized phone controls");
  await page.setContent('<style>body{margin:0}.app-with-bottom-nav{padding-bottom:20px}.app-bottom-nav{position:fixed;bottom:0;height:60px}</style><div class="app-with-bottom-nav"><main id="main-content">Page</main><nav class="app-bottom-nav">Navigation</nav></div>');
  assert.ok((await measure()).some(row=>row.rule==='nav-clearance'&&!row.ok),'undersized content clearance fails');
  await page.locator('.app-with-bottom-nav').evaluate(el=>{el.style.paddingBottom='76px';});
  assert.ok((await measure()).some(row=>row.rule==='nav-clearance'&&row.ok),'measured navigation plus a gap passes');
  await page.locator('.app-with-bottom-nav').evaluate(el=>{el.dataset.bottomClearance='';const bar=document.createElement('div');bar.dataset.bottomActions='';bar.id='detached';bar.style.cssText='position:fixed;bottom:60px;height:96px;width:100%';bar.textContent='Save changes';el.append(bar);});
  assert.ok((await measure()).some(row=>row.rule==='fixed-action-clearance'&&!row.ok),'navigation-only padding cannot pass when a detached action is present');
  await page.locator('.app-with-bottom-nav').evaluate(el=>{el.style.paddingBottom='172px';});
  assert.ok((await measure()).some(row=>row.rule==='fixed-action-clearance'&&row.ok),'measured action extent plus a gap passes');
  await page.locator('#detached').evaluate(el=>{el.style.bottom='20px';});
  assert.ok((await measure()).some(row=>row.rule==='action-nav-clearance'&&!row.ok),'actions overlapping bottom navigation fail independently of content padding');
  await page.setContent('<style>:root{--space-4:16px;--bottom-nav-height:64px;--floating-control-gap:16px}body{margin:0}.fantasy-chat-launcher-a{position:fixed;right:16px;bottom:80px;width:56px;height:56px}</style><main id="main-content"><button id="flowing" style="position:absolute;right:16px;bottom:80px;width:56px;height:56px">Scrolling action</button></main><div class="fantasy-chat-launcher-a">Chat</div>');
  assert.ok((await measure()).some(row=>row.rule==='chat-anchor'&&row.ok),'the fixed bottom-right navigation offset passes');
  await page.evaluate(()=>{document.documentElement.style.setProperty('--space-4','1rem');document.documentElement.style.setProperty('--floating-control-gap','1rem');});
  assert.ok((await measure()).some(row=>row.rule==='chat-anchor'&&row.ok),'rem spacing tokens resolve to viewport pixels');
  assert.ok((await measure()).some(row=>row.rule==='overlay-clearance'&&row.ok),'ordinary scrolling content does not force the launcher to dodge');
  await page.locator('#flowing').focus();
  assert.ok((await measure()).some(row=>row.rule==='overlay-clearance'&&!row.ok),'focused controls must still be exposed');
  await page.locator('#flowing').evaluate(el=>{el.blur();el.style.position='fixed';});
  assert.ok((await measure()).some(row=>row.rule==='overlay-clearance'&&!row.ok),'fixed page actions must reserve the chat lane');
  await page.locator('.fantasy-chat-launcher-a').evaluate(el=>{el.style.bottom='240px';});
  assert.ok((await measure()).some(row=>row.rule==='chat-anchor'&&!row.ok),'lifting the launcher to dodge content fails');
  await page.locator('.fantasy-chat-launcher-a').evaluate(el=>{el.style.bottom='80px';el.style.right='auto';el.style.left='16px';});
  assert.ok((await measure()).some(row=>row.rule==='chat-anchor'&&!row.ok),'switching the launcher to the left corner fails');
  await page.setContent('<button aria-label="Open chat, 3 unread messages" style="width:56px;height:56px"><svg></svg><span aria-hidden="true" style="position:absolute;top:0;right:0">3</span></button>');
  assert.deepEqual((await auditHighlightInsets(page)).filter(row=>!row.ok),[], 'decorative unread badges do not turn icon controls into text labels');
  await page.setContent('<button style="padding:0">Readable action</button>');
  assert.ok((await auditHighlightInsets(page)).some(row=>!row.ok), 'visible text labels still require insets');
  let pending, measuredWidth;
  const context=await browser.newContext();
  await context.route("http://127.0.0.1:5173/**", async route=>{
    const url=new URL(route.request().url());
    if(url.pathname==="/pending"){
      measuredWidth=Number(url.searchParams.get("width"));
      pending=route;
      return; // Deliberately leave this request unanswered until after the audit.
    }
    await route.fulfill({contentType:"text/html",body:'<main id="main-content"><h1>Ready page</h1><div hidden aria-busy="true"><span class="table-skeleton-cell">Hidden cached pane</span></div></main><script>fetch("/pending?width="+innerWidth)</script>'});
  });
  try {
    const checks=await auditRoute(context,"/",390,{base:"http://127.0.0.1:5173"});
    assert.equal(checks.some(row=>row.rule==="load"&&!row.ok),false);
    assert.equal(measuredWidth,390,"reused browser contexts still measure the requested CSS viewport");
    assert.ok(pending,"audit completes without answering the background request");
  } finally {
    if(pending)await pending.abort().catch(()=>{});
    await context.close();
  }
  console.log("PASS: grouped headers, totals, padding, missing values, skeletons, and genuine alignment/packing regressions");
} finally { await browser.close(); }
