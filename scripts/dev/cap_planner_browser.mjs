import { chromium } from '../../frontend/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const base = process.env.CAP_PREVIEW_BASE || 'http://127.0.0.1:5173/cap-review/test-fixtures/cap-planner.html';
const out = process.env.CAP_QA_OUTPUT || 'frontend/.cap-review';
await fs.mkdir(out, {
  recursive: true
});
const browser = await chromium.launch({
  headless: true
});
for (const width of [320, 390, 1280]) {
  const page = await browser.newPage({
      viewport: {
        width,
        height: 844
      }
    }),
    errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(base + '?long=1');
  await page.locator('.cap-planner-list').waitFor();
  assert.equal(await page.locator('.cap-planner-balance>strong').innerText(), '$48');
  await page.locator('.cap-planner-years button').nth(1).click();
  await page.locator('.cap-planner-row').filter({
    hasText: 'Josh Allen'
  }).getByRole('button', {
    name: 'Extend +',
    exact: true
  }).click();
  await page.getByRole('button', {
    name: '+2 yrs',
    exact: true
  }).click();
  assert.equal(await page.locator('.cap-planner-extension-years').count(), 0);
  assert.equal(await page.getByRole('button', {
    name: '+2 yrs · Edit',
    exact: true
  }).count(), 1);
  await page.locator('.cap-planner-years button').nth(2).click();
  assert.equal(await page.locator('.cap-planner-balance>strong').innerText(), '$103');
  await page.screenshot({
    path: `${out}/cap-${width}.png`,
    fullPage: true
  });
  await page.getByRole('button', {
    name: 'Around the league ↗'
  }).click();
  await page.locator('.cap-planner-team').first().waitFor();
  assert.equal(await page.locator('.cap-planner-team').count(), 2);
  await page.screenshot({
    path: `${out}/league-${width}.png`,
    fullPage: true
  });
  await page.getByRole('searchbox').fill('Jordan');
  await page.locator('.cap-planner-team').click();
  assert.ok((await page.locator('.cap-planner-context').innerText()).includes('Sunday Rivals'));
  assert.equal(await page.getByRole('button', {
    name: 'Back to my cap →'
  }).count(), 1);
  assert.equal(await page.getByRole('button', {
    name: /Queue extension|Cut and/
  }).count(), 0);
  assert.equal((await page.evaluate(() => window.fixtureWrites)).length, 0);
  await page.getByRole('button', {
    name: 'Back to my cap →'
  }).click();
  await page.locator('.cap-planner-years button').nth(1).click();
  await page.getByRole('button', {
    name: '+2 yrs · Edit',
    exact: true
  }).click();
  await page.getByRole('button', {
    name: 'Revert',
    exact: true
  }).click();
  await page.locator('.cap-planner-years button').nth(2).click();
  assert.equal(await page.locator('.cap-planner-balance>strong').innerText(), '$141');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []);
  console.log(`${width}: PASS math, collapse/revert, other teams, no writes, overflow`);
  await page.close();
}
for (const state of ['error', 'empty', 'loading', 'readonly', 'pick', 'no-data']) {
  const page = await browser.newPage({
    viewport: {
      width: 390,
      height: 844
    }
  });
  await page.goto(base + '?state=' + state);
  if (['error', 'empty', 'loading'].includes(state)) {
    await page.getByRole('button', {
      name: 'Around the league ↗'
    }).click();
    if (state === 'error') {
      await page.getByRole('alert').waitFor();
      assert.ok((await page.getByRole('alert').innerText()).includes('Could not load team caps'));
    } else if (state === 'loading') await page.locator('.cap-planner-team-loading').first().waitFor();else await page.getByText('No matching teams', {
      exact: true
    }).waitFor();
  }
  if (state === 'readonly') {
    await page.locator('.cap-planner-row').filter({
      hasText: 'Josh Allen'
    }).getByRole('button', {
      name: /preview cut/
    }).click();
    assert.equal(await page.locator('.cap-planner-move .btn-primary').isDisabled(), true);
    assert.equal((await page.evaluate(() => window.fixtureWrites)).length, 0);
  }
  if (state === 'pick') await page.getByText('Salaries do not apply', {
    exact: true
  }).waitFor();
  if (state === 'no-data') await page.getByText('Cap data unavailable', {
    exact: true
  }).waitFor();
  console.log(`${state}: PASS`);
  await page.close();
}
await browser.close();
