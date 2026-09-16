/** Run with Vite on :5173. Uses native snake/linear capability fixtures and in-memory API writes. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from '../../frontend/node_modules/playwright/index.mjs';
import { measureScript, NUMERIC_RE, BAR_CONTROL_SELECTOR, TABLE_DEAD_ZONE_PX, COLUMN_PACK_RATIO, GUTTER_EDGE_SELECTORS } from './layout_audit.mjs';
const base = process.env.ROSTER_QA_BASE || 'http://127.0.0.1:5173';
const output = process.env.ROSTER_QA_OUTPUT || '.codex_tmp/non-salary-qa';
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
const context = await browser.newContext();
await context.route('https://**/*', route => route.abort());
const reports = [];
const errors = [];
const financial = /\b(?:salary|salaries|cap|contracts?|years|committed|auction|winning bid|expired|expiring)\b/i;
async function open(surface, width, extra = '') {
  const page = await context.newPage();
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/test-fixtures/no-money-rosters.html?surface=${surface}&${extra}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.getByRole('heading', { name: surface === 'office' ? 'Roster moves' : 'My team', exact: true }).first().waitFor();
  return page;
}
async function noMoney(page) {
  assert.doesNotMatch(await page.locator('body').innerText(), financial);
}
async function selectTeam(page, width, name = 'Alex') {
  if (width === 390) {
    await page.getByRole('button', { name: /Team to edit/ }).click();
    await page.getByRole('option', { name, exact: true }).click();
  } else await page.getByRole('button', { name: new RegExp(`^${name}`) }).click();
}
async function audit(page, label, width, screenshot = false) {
  await page.evaluate(() => document.fonts.ready);
  const results = await page.evaluate(measureScript(), {
    minTarget: width === 390 ? 44 : 32, numericRe: NUMERIC_RE.source,
    barControlSelector: BAR_CONTROL_SELECTOR, tableDeadZonePx: TABLE_DEAD_ZONE_PX,
    columnPackRatio: COLUMN_PACK_RATIO, gutterSelectors: GUTTER_EDGE_SELECTORS,
  });
  reports.push({ label, width, results });
  if (screenshot) await page.screenshot({ path: `${output}/${label}-${width}.png`, fullPage: true, animations: 'disabled' });
  assert.equal(results.find(row => row.rule === 'overflow')?.ok, true, `${label} overflows at ${width}`);
}
try {
  for (const draft of ['snake', 'linear']) for (const completed of [false, true]) for (const width of [1280, 390]) {
    console.log(`Checking ${draft} ${completed ? 'after' : 'before'} draft ${width}`);
    const extra = `draft=${draft}${completed ? '&completed=1' : ''}`;
    const page = await open('team', width, extra);
    await page.getByRole('button', { name: 'Player details', exact: true }).first().waitFor();
    await noMoney(page);
    if (draft === 'snake' && completed) await audit(page, 'my-team', width, true);
    await page.getByRole('searchbox', { name: 'Search roster' }).fill('nobody matches');
    await page.getByText('No players match these filters.').waitFor();
    await page.getByRole('searchbox', { name: 'Search roster' }).fill('Josh');
    await page.getByRole('button', { name: 'Player details', exact: true }).click();
    const panel = page.getByRole('dialog');
    await panel.waitFor();
    await noMoney(page);
    if (draft === 'snake' && completed) await audit(page, 'player-details', width, true);
    await panel.getByRole('button', { name: 'Drop player', exact: true }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click();
    assert.equal(await page.evaluate(() => window.__requests.filter(r => r.method === 'DELETE').length), 0);
    await panel.getByRole('button', { name: 'Drop player', exact: true }).click();
    await noMoney(page);
    await page.getByRole('alertdialog').getByRole('button', { name: 'Drop player', exact: true }).click();
    await panel.waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => window.__requests.filter(r => r.method === 'DELETE').length), 1);
    await page.close();
    const office = await open('office', width, extra);
    await selectTeam(office, width);
    await office.getByRole('button', { name: 'Drop Josh Allen', exact: true }).waitFor();
    await noMoney(office);
    assert.match(await office.locator('.hub-league-team-card-stats').innerText(), /2 players/);
    if (draft === 'snake' && completed) await audit(office, 'roster-moves', width, true);
    await office.getByRole('combobox', { name: 'Player', exact: true }).fill('Chase');
    await office.getByRole('button', { name: /Ja'Marr Chase/ }).click();
    assert.equal(await office.getByRole('button', { name: 'Add to roster', exact: true }).isEnabled(), true);
    await office.getByRole('button', { name: 'Add to roster', exact: true }).click();
    await office.getByRole('button', { name: "Drop Ja'Marr Chase", exact: true }).waitFor();
    await office.getByRole('button', { name: 'Drop Josh Allen', exact: true }).click();
    await noMoney(office);
    await office.getByRole('alertdialog').getByRole('button', { name: 'Drop player', exact: true }).click();
    await office.getByRole('button', { name: 'Drop Josh Allen', exact: true }).waitFor({ state: 'hidden' });
    await office.getByText('Roster updated.', { exact: true }).waitFor();
    await noMoney(office);
    assert.equal(await office.locator('.hub-office-pending-tray').count(), 0);
    assert.equal(await office.evaluate(() => window.__requests.filter(r => r.method === 'DELETE').length), 1);
    await office.getByRole('searchbox', { name: 'Search players' }).fill('no match');
    await office.getByText('No teams match your search.').waitFor();
    await office.close();
    console.log(`PASS ${draft} ${completed ? 'after' : 'before'} draft ${width}: details, filters, add, confirmed immediate drop`);
  }
  for (const width of [1280, 390]) {
    const empty = await open('team', width, 'empty=1');
    await empty.getByText('No players on your roster yet.').waitFor();
    await noMoney(empty);
    await audit(empty, 'empty-team', width);
    await empty.close();
    const member = await open('team', width, 'readonly=1&sleeper=1');
    await member.getByRole('button', { name: 'Player details', exact: true }).first().click();
    assert.equal(await member.getByRole('button', { name: 'Drop player', exact: true }).count(), 0);
    await noMoney(member);
    await member.close();
    const office = await open('office', width, 'loading=1&sleeper=1');
    await selectTeam(office, width);
    await noMoney(office);
    await office.evaluate(() => { window.__failWrite = true; });
    await office.getByRole('button', { name: 'Drop Josh Allen', exact: true }).click();
    await office.getByRole('alertdialog').getByRole('button', { name: 'Drop player', exact: true }).click();
    await office.getByText('Roster update failed. Try again.', { exact: true }).first().waitFor();
    assert.equal(await office.getByRole('button', { name: 'Drop Josh Allen', exact: true }).isVisible(), true);
    await office.close();
    const failed = await open('office', width, 'error=1');
    await failed.getByText('Roster unavailable. Try again.', { exact: true }).waitFor();
    await failed.close();
    console.log(`PASS ${width}: empty, member, Sleeper row, loading, failed write, failed load`);
  }
  // Salary-cap behavior stays available on the same components.
  for (const width of [1280, 390]) {
    const page = await context.newPage();
    await page.setViewportSize({ width, height: 900 });
      await page.goto(`${base}/test-fixtures/no-money-rosters.html?draft=auction`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.getByRole('button', { name: 'Contract', exact: true }).first().click();
    await page.getByRole('dialog').getByText('Contract type', { exact: true }).waitFor();
    await page.getByRole('dialog').getByText('Salary schedule', { exact: true }).waitFor();
    await page.close();
    console.log(`PASS auction regression ${width}`);
  }
  assert.deepEqual(errors, []);
} finally {
  fs.writeFileSync(`${output}/layout.json`, JSON.stringify(reports, null, 2));
  await browser.close();
}
console.log('Layout results:', reports.map(row => ({ surface: row.label, width: row.width, failures: row.results.filter(r => !r.ok) })));

const layoutFailures = reports.flatMap(row => row.results.filter(result => !result.ok).map(result => ({ surface: row.label, width: row.width, ...result })));
assert.deepEqual(layoutFailures, [], 'All roster layout rules must pass');
