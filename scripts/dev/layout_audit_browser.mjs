// Real DOM regression checks for table-audit geometry. No app/API is required.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
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
  <table id="cards" style="display:block"><tbody><tr style="display:grid;grid-template-columns:1fr 1fr"><td>Sample manager</td><td class="wide">—</td></tr></tbody></table>`);
  const measure = () => page.evaluate(measureScript(), { minTarget:32, numericRe:NUMERIC_RE.source, barControlSelector:BAR_CONTROL_SELECTOR,
    tableDeadZonePx:TABLE_DEAD_ZONE_PX, columnPackRatio:COLUMN_PACK_RATIO, gutterSelectors:GUTTER_EDGE_SELECTORS });
  assert.deepEqual((await measure()).filter(row => row.rule === "tables" && !row.ok), [], "grouped headers, padded numeric cells, totals and missing timestamps align correctly");
  await page.locator("#grouped tbody tr").first().locator("td").nth(1).evaluate(el => { el.style.textAlign = "left"; });
  assert.ok((await measure()).some(row => row.rule === "tables" && !row.ok && row.detail.includes("align≠right")), "a real numeric misalignment still fails");
  await page.locator("#grouped tbody tr").first().locator("td").nth(1).evaluate(el => { el.style.textAlign = "right"; el.classList.add("wide"); });
  assert.ok((await measure()).some(row => row.rule === "tables" && !row.ok && row.detail.includes("content")), "a real overwide numeric column still fails");
  let pending, measuredWidth;
  const server=createServer((request,response)=>{
    if(request.url.startsWith("/pending")){measuredWidth=Number(new URL(request.url,"http://localhost").searchParams.get("width"));pending=response;response.writeHead(200);response.flushHeaders();return;}
    response.writeHead(200,{"Content-Type":"text/html"});
    response.end('<main id="main-content"><h1>Ready page</h1><div hidden aria-busy="true"><span class="table-skeleton-cell">Hidden cached pane</span></div></main><script>fetch("/pending?width="+innerWidth)</script>');
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  try {
    const context=await browser.newContext();
    const checks=await auditRoute(context,"/",390,{base:`http://127.0.0.1:${server.address().port}`});
    assert.equal(checks.some(row=>row.rule==="load"&&!row.ok),false);
    assert.equal(measuredWidth,390,"reused browser contexts still measure the requested CSS viewport");
    assert.ok(pending&&!pending.writableEnded,"audit completes while the background response remains unfinished");
    await context.close();
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  console.log("PASS: grouped headers, totals, padding, missing values, skeletons, and genuine alignment/packing regressions");
} finally { await browser.close(); }
