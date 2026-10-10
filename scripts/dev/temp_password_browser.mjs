// Exercise the production build with isolated responses; no real accounts change.
import { chromium } from '../../frontend/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  measureScript, minTargetForWidth, NUMERIC_RE, BAR_CONTROL_SELECTOR,
  TABLE_DEAD_ZONE_PX, COLUMN_PACK_RATIO, GUTTER_EDGE_SELECTORS,
} from './layout_audit.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const dist = path.join(root, 'frontend/dist');
const out = path.join(root, 'frontend/qa-dist/temp-password');
const base = 'http://127.0.0.1:5173';
const browser = await chromium.launch({ headless: true });
const reports = [];
await fs.mkdir(out, { recursive: true });
try {
  for (const mode of ['dark', 'light']) for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
    const owner = { id: 'owner', email: 'owner@mail.com', user_sub: 'ss:owner', auth_type: 'native',
      display_name: 'Owner', email_verified_at: '2026-10-09T00:00:00+00:00', memberships: [],
      has_password: true, must_change_password_at: '2026-10-10T00:00:00+00:00', can_deactivate_temp_password: false };
    const user = { id: 'admin', email: 'admin@mail.com', name: 'Admin', auth_type: 'native',
      is_admin: true, email_verified: true, has_password: false, google_linked: false };
    let failDeactivate = true, deactivateCalls = 0;
    const errors = [];
    await context.addInitScript(mode => localStorage.setItem('scoresense-color-theme', mode), mode);
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== base) return route.abort();
      if (url.pathname.startsWith('/api/')) {
        const reply = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
        if (url.pathname === '/api/auth/config') return reply({ auth_required: false, hub_auth_required: false, admin_configured: true });
        if (url.pathname === '/api/auth/me') return reply({ authenticated: true, user });
        if (url.pathname === '/api/admin/users') return reply({ accounts: [owner], system_subs: [] });
        if (url.pathname === '/api/admin/leagues') return reply({ leagues: [] });
        if (url.pathname === '/api/hub/prefs') return reply({ prefs: {} });
        if (url.pathname === '/api/state') return reply({ season: 2026, week: 5, season_type: 'regular' });
        if (url.pathname === '/api/admin/users/owner/temp-password/deactivate') {
          deactivateCalls += 1;
          assert.equal(request.method(), 'POST');
          if (failDeactivate) return reply({ detail: 'Could not deactivate this password.' }, 500);
          owner.must_change_password_at = null;
          owner.can_deactivate_temp_password = false;
          owner.has_password = false;
          return reply({ user_id: owner.id, email: owner.email, must_change_password: false });
        }
        return reply({ ok: true });
      }
      const relative = request.resourceType() === 'document' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
      const file = path.resolve(dist, relative);
      if (!file.startsWith(dist + path.sep)) return route.abort();
      try {
        const body = await fs.readFile(file);
        const contentType = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
          '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' }[path.extname(file)] || 'application/octet-stream';
        return route.fulfill({ body, contentType });
      } catch { return route.abort(); }
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    const audit = async scene => {
      const results = await page.evaluate(measureScript(), {
        minTarget: minTargetForWidth(width), numericRe: NUMERIC_RE.source,
        barControlSelector: BAR_CONTROL_SELECTOR, tableDeadZonePx: TABLE_DEAD_ZONE_PX,
        columnPackRatio: COLUMN_PACK_RATIO, gutterSelectors: GUTTER_EDGE_SELECTORS,
      });
      reports.push({ mode, width, scene, results });
      console.log(JSON.stringify({ mode, width, scene, failures: results.filter(row => !row.ok) }));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${scene}: no page overflow`);
    };
    await page.goto(base + '/admin/users', { waitUntil: 'networkidle' });
    if (width === 390) await page.locator('.mobile-player-card-header').click();
    const deactivate = page.getByRole('button', { name: 'Deactivate temp password', exact: true });
    await deactivate.waitFor();
    assert.equal(await deactivate.isDisabled(), true, 'wait for successful sign-in');
    assert.equal(deactivateCalls, 0);
    await audit('waiting');
    owner.can_deactivate_temp_password = true;
    // The existing phone tab rail clips Refresh; a page reload also refreshes accounts.
    if (width === 390) await page.reload({ waitUntil: 'networkidle' });
    else await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button =>
      button.textContent.trim() === 'Deactivate temp password' && !button.disabled));
    if (width === 390) await page.locator('.mobile-player-card-header').click();
    assert.equal(await deactivate.isEnabled(), true);
    await audit('available');
    await page.screenshot({ path: path.join(out, `admin-${mode}-${width}.png`), fullPage: true });
    await deactivate.click();
    await page.getByRole('alert').filter({ hasText: 'Could not deactivate this password.' }).waitFor();
    assert.equal(await deactivate.isEnabled(), true, 'failed action stays retryable');
    failDeactivate = false;
    await deactivate.click();
    await page.getByRole('status').filter({ hasText: 'Temporary password deactivated for owner@mail.com' }).waitFor();
    assert.equal(deactivateCalls, 2);
    assert.equal(await deactivate.count(), 0, 'retired credential no longer offers deactivation');
    await audit('deactivated');
    await page.goto(base + '/account', { waitUntil: 'networkidle' });
    await page.getByText('Password sign-in is disabled. Use Forgot password to set a new one.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('link', { name: 'Forgot password?', exact: true }).count(), 1);
    await audit('account');
    await page.screenshot({ path: path.join(out, `account-${mode}-${width}.png`), fullPage: true });
    assert.deepEqual(errors, [], 'no browser runtime errors');
    await context.close();
  }
} finally {
  await fs.writeFile(path.join(out, 'audit.json'), JSON.stringify(reports, null, 2));
  await browser.close();
}
console.log('PASS: temporary password actions and recovery at both widths in both themes.');
