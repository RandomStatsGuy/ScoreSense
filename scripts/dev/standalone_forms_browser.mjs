// Verify the exact production build using intercepted local responses. No real
// account changes, SMS enrollments, or bug reports leave this browser context.
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
const out = path.join(root, 'frontend/qa-dist/form-alignment');
const base = process.env.LAYOUT_AUDIT_BASE || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ headless: true });
const reports = [];
await fs.mkdir(out, { recursive: true });
const scenarios = [
  { route: '/account', signedIn: true },
  { route: '/report?from=%2Faccount', signedIn: true },
  { route: '/sms-alerts', signedIn: true },
  { route: '/register' }, { route: '/login' },
  { route: '/auth/forgot-password' },
  { route: '/auth/reset-password?token=fixture' },
  { route: '/terms' }, { route: '/privacy' },
];

async function audit(page, width, scene) {
  const results = await page.evaluate(measureScript(), {
    minTarget: minTargetForWidth(width), numericRe: NUMERIC_RE.source,
    barControlSelector: BAR_CONTROL_SELECTOR, tableDeadZonePx: TABLE_DEAD_ZONE_PX,
    columnPackRatio: COLUMN_PACK_RATIO, gutterSelectors: GUTTER_EDGE_SELECTORS,
  });
  reports.push({ width, scene, results });
  console.log(JSON.stringify({ width, scene, failures: results.filter(row => !row.ok) }));
  return results;
}

try {
  for (const mode of ['light', 'dark']) for (const width of [1280, 390]) {
    for (const scenario of scenarios) {
      const context = await browser.newContext({
        viewport: { width, height: width === 390 ? 844 : 900 },
        serviceWorkers: 'block', reducedMotion: 'reduce',
      });
      const requests = [], errors = [];
      let failSave = false;
      const user = { id: 'fixture', name: 'Jordan', email: 'jordan@example.com',
        auth_type: 'native', has_password: true, email_verified: true };
      const prefs = { atmosphere: mode === 'light' ? 'snow' : 'none', atmosphere_enabled: true,
        atmosphere_falling: false, atmosphere_companions: false, atmosphere_reactions: false };
      await context.addInitScript(({ mode, prefs }) => {
        localStorage.setItem('scoresense-color-theme', mode);
        localStorage.setItem('scoresense-appearance', JSON.stringify(prefs));
      }, { mode, prefs });
      await context.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin !== base) return route.abort();
        if (url.pathname.startsWith('/api/')) {
          const reply = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
          if (request.method() !== 'GET') requests.push({ path: url.pathname, body: request.postDataJSON() });
          if (url.pathname === '/api/auth/config') return reply({ auth_required: false,
            hub_auth_required: false, google_configured: true, patreon_configured: true });
          if (url.pathname === '/api/auth/me') return reply({ authenticated: Boolean(scenario.signedIn), user: scenario.signedIn ? user : null });
          if (url.pathname === '/api/hub/prefs') return reply({ prefs });
          if (url.pathname === '/api/support/bugs/status') return reply({ enabled: true });
          if (url.pathname === '/api/auth/profile') {
            if (failSave) return reply({ detail: 'Profile could not be saved.' }, 500);
            user.name = request.postDataJSON().display_name;
            return reply({ user });
          }
          if (url.pathname === '/api/auth/sms-opt-in') {
            user.phone = request.postDataJSON().phone;
            user.sms_opted_in = true;
            return reply({ ok: true });
          }
          return reply({ ok: true });
        }
        const relative = request.resourceType() === 'document' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
        const file = path.resolve(dist, relative);
        if (!file.startsWith(dist + path.sep)) return route.abort();
        try {
          const body = await fs.readFile(file);
          const type = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
            '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
            '.webmanifest': 'application/manifest+json' }[path.extname(file)] || 'application/octet-stream';
          return route.fulfill({ body, contentType: type });
        } catch { return route.abort(); }
      });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(base + scenario.route, { waitUntil: 'networkidle' });
      await page.locator('.standalone-content, .auth-session-card').first().waitFor();
      const name = scenario.route.split('?')[0].replaceAll('/', '-').slice(1);
      const scene = `${mode}-${name}`;
      await audit(page, width, scene);
      await page.screenshot({ path: path.join(out, `${scene}-${width}.png`), fullPage: true });
      assert.deepEqual(errors, [], `${scene}: no runtime errors`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, `${scene}: no horizontal overflow`);

      if (scenario.route === '/account') {
        await page.getByLabel('Display name', { exact: true }).fill('Updated manager');
        failSave = true;
        await page.getByRole('button', { name: 'Save name', exact: true }).click();
        await page.getByText('Profile could not be saved.', { exact: true }).waitFor();
        assert.equal(await page.getByLabel('Display name', { exact: true }).inputValue(), 'Updated manager');
        await audit(page, width, `${scene}-save-error`);
        failSave = false;
        await page.getByRole('button', { name: 'Save name', exact: true }).click();
        await page.getByText('Display name updated.', { exact: true }).waitFor();
        await page.locator('.account-settings-danger > summary').click();
        await audit(page, width, `${scene}-delete-expanded`);
        await page.screenshot({ path: path.join(out, `${scene}-delete-${width}.png`), fullPage: true });
      }
      if (scenario.route === '/sms-alerts') {
        await page.getByLabel('Mobile phone number', { exact: true }).fill('15555550199');
        await page.getByRole('button', { name: 'Yes, text me', exact: true }).click();
        assert.equal(requests.filter(item => item.path === '/api/auth/sms-opt-in').length, 0, 'consent required before sending');
        await page.locator('.legal-terms-checkbox input').check();
        await page.getByRole('button', { name: 'Yes, text me', exact: true }).click();
        await page.getByText('You will get draft alert texts at this number. Reply STOP to cancel.', { exact: true }).waitFor();
        assert.equal(requests.filter(item => item.path === '/api/auth/sms-opt-in').length, 1);
        await audit(page, width, `${scene}-saved`);
      }
      if (scenario.route === '/register') {
        const submit = page.locator('.account-auth-submit');
        assert.equal(await submit.isDisabled(), true);
        await page.locator('.legal-terms-checkbox input').check();
        assert.equal(await submit.isDisabled(), false);
      }
      if (scenario.route.startsWith('/report')) {
        await page.getByRole('button', { name: 'Where: Account', exact: true }).click();
        await page.getByRole('option', { name: 'Fantasy', exact: true }).click();
        await page.getByRole('button', { name: 'Where: Fantasy', exact: true }).waitFor();
        await audit(page, width, `${scene}-selected-area`);
      }
      if (scenario.route === '/sms-alerts' && mode === 'light' && width === 1280) {
        // The checks must reject each original failure, not just accept the fix.
        const regressions = [
          ['form-columns', '.standalone-form-content { max-width: none; margin-inline: 0; }'],
          ['consent-rows', '.account-auth-form .legal-terms-checkbox { display: grid; }'],
          ['form-footers', '.standalone-page-footer { justify-items: start; }'],
          ['form-disclosures', '.sms-opt-in-disclosures > p { margin-block: 24px; }'],
          ['form-labels', '.account-auth-form label { text-align: center; }'],
          ['form-controls', '.account-auth-form input[type="tel"] { height: 20px; min-height: 20px; padding: 0; }'],
        ];
        for (const [rule, content] of regressions) {
          const style = await page.addStyleTag({ content });
          const results = await page.evaluate(measureScript(), { minTarget: 32, numericRe: NUMERIC_RE.source });
          assert.ok(results.some(result => result.rule === rule && !result.ok), `${rule} catches a regression`);
          await style.evaluate(element => element.remove());
        }
      }
      await context.close();
    }
  }
  await fs.writeFile(path.join(out, 'audit.json'), JSON.stringify(reports, null, 2));
  const failures = reports.flatMap(report => report.results.filter(result => !result.ok).map(result => ({ width: report.width, scene: report.scene, ...result })));
  assert.deepEqual(failures, [], 'all affected routes pass the full layout audit');
  console.log(`PASS: ${reports.length} layout audits; screenshots in ${out}`);
} finally { await browser.close(); }
