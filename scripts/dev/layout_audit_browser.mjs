// Real DOM regression checks for table-audit geometry. No app/API is required.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { auditRoute, measureScript, NUMERIC_RE, BAR_CONTROL_SELECTOR, TABLE_DEAD_ZONE_PX, COLUMN_PACK_RATIO, GUTTER_EDGE_SELECTORS } from "./layout_audit.mjs";
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
