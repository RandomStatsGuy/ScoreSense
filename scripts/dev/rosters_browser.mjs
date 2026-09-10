import { pathToFileURL } from 'node:url';
import path from 'node:path';
const {
  chromium
} = await import(process.env.PLAYWRIGHT_MODULE || pathToFileURL(path.resolve('frontend/node_modules/playwright/index.mjs')).href);
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { measureScript, NUMERIC_RE, BAR_CONTROL_SELECTOR, TABLE_DEAD_ZONE_PX, COLUMN_PACK_RATIO, GUTTER_EDGE_SELECTORS } from './layout_audit.mjs';
fs.mkdirSync('outputs', {
  recursive: true
});
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHANNEL ? {
    channel: process.env.PLAYWRIGHT_CHANNEL
  } : {})
});
try {
const page = await browser.newPage({
  viewport: {
    width: 1536,
    height: 1024
  }
});
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto('http://127.0.0.1:5173/test-fixtures/rosters.html');
await page.getByRole('button', {
  name: 'View Matthew Stafford contract'
}).waitFor();
await page.locator('.rosters-detail').waitFor();
await page.getByRole('button', {
  name: 'Propose trade',
  exact: true
}).click();
assert.equal(await page.evaluate(() => window.__trade), true);
assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem('ss_hub_trade_seed')).players[0].player_name), 'Matthew Stafford');
await page.getByRole('button', {
  name: 'View contract history'
}).click();
assert.equal(await page.evaluate(() => window.__history.playerName), 'Matthew Stafford');
await page.getByRole('button', {
  name: 'View Saquon Barkley contract'
}).click();
await page.getByRole('complementary', {
  name: 'Saquon Barkley contract'
}).waitFor();
await page.keyboard.press('Escape');
assert.equal(await page.locator('.rosters-detail').count(), 0);
assert.equal(await page.getByRole('button', {
  name: 'View Saquon Barkley contract'
}).evaluate(e => e === document.activeElement), true);
await page.getByRole('radio', {
  name: 'Above estimate',
  exact: true
}).click();
assert.equal(await page.locator('.rosters-table tbody > tr').count(), 4);
await page.getByRole('radio', {
  name: 'All',
  exact: true
}).click();
await page.getByRole('textbox', {
  name: 'Search players'
}).fill('zzzzz');
await page.getByText('No contracts match these filters.').waitFor();
await page.getByRole('button', {
  name: 'Reset filters'
}).click();
await page.getByRole('button', {
  name: 'Next page'
}).click();
await page.getByText('Showing 9–16 of 16 contracts').waitFor();
await page.getByRole('textbox', {
  name: 'Search players'
}).fill('Baker');
await page.getByText('Showing 1–1 of 1 contracts').waitFor();
await page.getByRole('textbox', {
  name: 'Search players'
}).fill('');
await page.getByRole('button', {
  name: 'Manager: All teams'
}).click();
await page.getByRole('textbox', {
  name: 'Find a manager or team'
}).fill('Andrew');
await page.locator('.rosters-filter-options button').filter({
  hasText: 'Andrew M'
}).click();
assert.equal(await page.locator('.rosters-table tbody > tr').count(), 2);
await page.getByRole('tab', {
  name: 'Team rosters'
}).click();
await page.locator('.rosters-team-summary').waitFor();
await page.evaluate(() => window.__setLocked(true));
assert.equal(await page.locator('.rosters-detail .rosters-primary').isDisabled(), true);
await page.evaluate(() => window.__setLocked(false));
await page.getByRole('button', {
  name: 'Manager: Andrew M'
}).click();
await page.locator('.rosters-filter-options button').filter({
  hasText: 'All teams'
}).click();
await page.getByRole('tab', {
  name: 'Contract values'
}).click();
await page.evaluate(() => window.__failure = true);
await page.getByRole('button', {
  name: 'Refresh league'
}).click();
await page.getByRole('alert').waitFor();
assert.ok(await page.locator('.rosters-table tbody > tr').count());
await page.evaluate(() => {
  window.__failure = false;
  window.__empty = true;
});
await page.getByRole('button', {
  name: 'Refresh league'
}).click();
await page.getByText('No contracts match these filters.').waitFor();
await page.evaluate(() => {
  window.__empty = false;
  window.__delay = 350;
  window.__setLeague('second');
});
await page.locator('.rosters-skeleton').waitFor();
assert.equal(await page.getByText('No contracts match these filters.').count(), 0);
await page.getByRole('button', {
  name: 'View Matthew Stafford contract'
}).waitFor();
await page.evaluate(() => window.__delay = 0);
const reports = [];
for (const width of [1536, 1440, 1280, 1024, 390]) {
  await page.setViewportSize({
    width,
    height: width === 390 ? 844 : 1024
  });
  await page.waitForTimeout(150);
  const report = await page.evaluate(measureScript(), {
    minTarget: width === 390 ? 44 : 32,
    numericRe: NUMERIC_RE.source,
    barControlSelector: BAR_CONTROL_SELECTOR,
    tableDeadZonePx: TABLE_DEAD_ZONE_PX,
    columnPackRatio: COLUMN_PACK_RATIO,
    gutterSelectors: GUTTER_EDGE_SELECTORS
  });
  reports.push({
    width,
    fail: report.filter(r => !r.ok),
    report
  });
  await page.screenshot({
    path: `outputs/rosters-${width}.png`,
    fullPage: true
  });
  assert.equal(await page.locator('.rosters-board').evaluate(el => el.scrollWidth > el.clientWidth), false, `overflow ${width}`);
}
await page.getByRole('button', {
  name: 'View Saquon Barkley contract'
}).click();
assert.equal(await page.locator('.rosters-inline-detail').count(), 1);
await page.getByRole('button', {
  name: 'Close player details'
}).click();
assert.equal(await page.locator('.rosters-inline-detail').count(), 0);
assert.deepEqual(errors, []);
fs.writeFileSync('outputs/rosters-audit.json', JSON.stringify(reports, null, 2));
assert.ok(reports.every(row => row.fail.length === 0), "layout audit failed; see outputs/rosters-audit.json");
console.log(JSON.stringify({
  interactions: 'PASS',
  errors,
  audit: reports.map(({
    width,
    fail
  }) => ({
    width,
    fail
  }))
}, null, 2));
} finally { await browser.close(); }
