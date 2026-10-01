// Real app companion interactions; all account writes are intercepted.
// Verify the production build with the existing local API. Preferences are
// intercepted so reviewing themes never changes the developer's account.
// npm --prefix frontend run build && node scripts/dev/appearance_browser.mjs --all
import { chromium } from "../../frontend/node_modules/playwright/index.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { measureScript, NUMERIC_RE, BAR_CONTROL_SELECTOR, TABLE_DEAD_ZONE_PX, COLUMN_PACK_RATIO, GUTTER_EDGE_SELECTORS, livingSurfaceRoutes } from "./layout_audit.mjs";
import { buildCompanionArt } from "../../frontend/src/DraftHub/companionArt.js";
import { toyBounds } from "../../frontend/src/DraftHub/companionPhysics.js";
import { LIVING_SURFACES } from "../../frontend/src/livingSurfaces.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dist = path.join(root, "frontend/dist");
const out = path.join(root, "docs/mockups/companion-review");
const origin = "http://127.0.0.1:5173";
const buildVersion = (await fs.readFile(path.join(dist, "index.html"), "utf8")).match(/name="scoresense-build" content="([^"]+)"/)?.[1];
const defaults = { atmosphere: "none", atmosphere_enabled: true, atmosphere_motion: true, atmosphere_pile: true, atmosphere_wash: true, atmosphere_intensity: "standard" };
let prefs = { ...defaults };
let gets = 0;
let failPatch = false;
let failLoad = false;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 900 } });
await fs.mkdir(out, { recursive: true });
await context.route(`${origin}/**`, async (route) => {
  const url = new URL(route.request().url());
  if (url.pathname === "/api/client-version") return route.fulfill({ json: { version: buildVersion } });
  if (url.pathname === "/api/auth/me") return route.fulfill({ json: {
    authenticated: true, user: { id: "appearance-review", auth_type: "native", name: "Theme review", email: "themes@example.test", has_password: true, email_verified: true, terms_version: "2026-09" },
  } });
  if (url.pathname === "/api/hub/prefs") {
    let loadedPrefs;
    if (route.request().method() === "PATCH") {
      if (failPatch) { failPatch = false; return route.fulfill({ status: 503, json: { detail: "Could not save appearance. Please try again." } }); }
      prefs = { ...prefs, ...route.request().postDataJSON() };
    } else {
      gets++;
      if (failLoad) return route.fulfill({ status: 503, json: { detail: "Could not load appearance." } });
      loadedPrefs = { ...prefs };
      // Give the loading state a real interval to protect saved preferences.
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return route.fulfill({ json: { prefs: loadedPrefs || prefs } });
  }
  if (url.pathname.startsWith("/api/")) return route.continue();
  const target = path.resolve(dist, decodeURIComponent(url.pathname).replace(/^\/+/, ""));
  if (!target.startsWith(dist + path.sep) && target !== dist) return route.abort();
  const file = route.request().isNavigationRequest() ? path.join(dist, "index.html") : target;
  const types = { ".js": "application/javascript", ".css": "text/css", ".html": "text/html", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp" };
  try { await route.fulfill({ body: await fs.readFile(file), contentType: types[path.extname(file)] || "application/octet-stream" }); }
  catch { await route.abort(); }
});
const report = [];
const errors = [];
const page = await context.newPage();
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", message => { if (message.type() === "error" && /ReferenceError|TypeError/.test(message.text())) { errors.push(message.text()); console.error(message.text()); } });
const themeRadio = (id) => page.locator(`#appearance input[name="appearance-theme"][value="${id}"]`);
const modeRadio = (id) => page.locator(`#appearance input[name="appearance-mode"][value="${id}"]`);
async function selectTheme(id) {
  await themeRadio(id).check();
  await page.waitForFunction((id) => document.documentElement.dataset.experienceTheme === id, id);
  await themeRadio(id).waitFor({ state: "visible" });
  await page.waitForFunction(() => !document.querySelector('#appearance input[name="appearance-theme"]:disabled'));
}
async function navigate(route) {
  await page.evaluate((route) => { history.pushState({}, "", route); dispatchEvent(new PopStateEvent("popstate")); }, route);
  await page.locator(".app-header:visible, .standalone-page:visible, .auth-session:visible").first().waitFor();
  await page.waitForTimeout(650);
  await page.waitForFunction(() => !document.querySelector(".hub-loading-skeleton, .hub-insights-skeleton, .table-skeleton-row"), null, { timeout: 15000 }).catch(() => {});
}
async function measure(route, width, theme, mode) {
  const results = await page.evaluate(measureScript(), { minTarget: width === 390 ? 44 : 32, numericRe: NUMERIC_RE.source, barControlSelector: BAR_CONTROL_SELECTOR, tableDeadZonePx: TABLE_DEAD_ZONE_PX, columnPackRatio: COLUMN_PACK_RATIO, gutterSelectors: GUTTER_EDGE_SELECTORS });
  const failures = results.filter((result) => !result.ok && ["type", "selects", "collisions", "grids", "atmosphere-ground", "companion-controls", "companion-bounds"].includes(result.rule));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  report.push({ route, actualPath: new URL(page.url()).pathname, width, theme, mode, ok: failures.length === 0 && !overflow, failures, overflow });
  assert.equal(overflow, false, `${route} ${width} ${theme} horizontal overflow`);
  assert.deepEqual(failures, [], `${route} ${width} ${theme} ${mode} layout gate`);
}
async function contrast() {
  const colors = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    const probe = document.createElement("span");
    document.body.appendChild(probe);
    const resolved = (name) => { probe.style.color = style.getPropertyValue(name); return getComputedStyle(probe).color; };
    const result = ["--text-primary", "--text-muted", "--bg-elevated", "--accent", "--appearance-action-ink"].map(resolved);
    probe.remove();
    return result;
  });
  const luminance = (color) => color.match(/[\d.]+/g).slice(0, 3).map(Number).map((value) => {
    const s = value / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4;
  }).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
  const ratio = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
  for (const [a, b] of [[0, 2], [1, 2], [3, 2], [3, 4]]) assert.ok(ratio(colors[a], colors[b]) >= 4.5, `Contrast ${colors[a]} on ${colors[b]}`);
}

async function waitSaved() { await page.waitForFunction(() => !document.querySelector('#appearance input:disabled')); }
async function layer(name, checked) { await page.getByRole('checkbox', { name: new RegExp('^' + name) }).setChecked(checked); await waitSaved(); }
async function screenPoint(scene, x, y) {
  return scene.locator('.companion-art').evaluate((svg, point) => {
    const p = new DOMPoint(point.x, point.y).matrixTransform(svg.getScreenCTM());
    return { x: p.x, y: p.y };
  }, { x, y });
}
async function dragCorner(scene, toy, x, y) {
  const button = scene.locator('.companion-interaction[data-toy="' + toy.id + '"]');
  const box = await button.boundingBox();
  const destination = await screenPoint(scene, x, y);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(destination.x, destination.y, { steps: 5 });
  const values = await scene.evaluate((host, toy) => {
    const friend = host.querySelector('[data-buddy="' + toy.buddy + '"]');
    const object = host.querySelector('[id$="-toy-' + toy.id + '"]');
    const matrix = object.transform.baseVal.consolidate().matrix;
    const point = new DOMPoint(matrix.e, matrix.f).matrixTransform(host.querySelector('.companion-art').getScreenCTM());
    return { x: matrix.e, y: matrix.f, playing: friend.classList.contains('playing'), pupils: [...friend.querySelectorAll('.companion-pupil')].map(pupil => {
      const local = point.matrixTransform(pupil.parentElement.getScreenCTM().inverse());
      const motion = new DOMMatrix(getComputedStyle(pupil).transform);
      return { dx: local.x - Number(pupil.dataset.gazeX), dy: local.y - Number(pupil.dataset.gazeY), tx: motion.e, ty: motion.f, rx: Number(pupil.dataset.gazeRangeX || 1.5), ry: Number(pupil.dataset.gazeRangeY || 1.1) };
    }) };
  }, toy);
  assert.ok(values.playing, 'only the dragged toy wakes its owner');
  assert.ok(Math.abs(values.x - x) < 1 && Math.abs(values.y - y) < 1, 'object follows drag within square');
  for (const pupil of values.pupils) {
    if (Math.abs(pupil.dx) > 10) assert.equal(Math.sign(pupil.tx), Math.sign(pupil.dx), 'gaze follows real face-to-toy direction');
    if (Math.abs(pupil.dy) > 10) assert.equal(Math.sign(pupil.ty), Math.sign(pupil.dy), 'vertical gaze follows toy');
    assert.ok(Math.abs(pupil.tx) <= pupil.rx && Math.abs(pupil.ty) <= pupil.ry, 'pupils stay within their eyes');
  }
  const area = await scene.locator('.companion-drag-area').boundingBox();
  assert.ok(Math.abs(area.width - area.height) < 1, 'movement area is a square');
  const guidePaint = await scene.locator('.companion-drag-area').evaluate((area) => {
    const style = getComputedStyle(area);
    return {
      borders: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth],
      background: style.backgroundColor,
      image: style.backgroundImage,
      shadow: style.boxShadow,
      outline: style.outlineStyle,
    };
  });
  assert.deepEqual(guidePaint, { borders: ['0px', '0px', '0px', '0px'], background: 'rgba(0, 0, 0, 0)', image: 'none', shadow: 'none', outline: 'none' }, 'movement limits stay invisible during dragging');
  await page.mouse.up();
}

try {
  await page.goto(origin + '/account#appearance');
  await waitSaved();
  for (const width of [1280, 390, 2501]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : width === 2501 ? 1149 : 900 });
    for (const theme of ['cozy', 'snow', 'leaves', 'footballs']) {
      await navigate('/account#appearance');
      await selectTheme(theme);
      for (const mode of ['light', 'dark']) {
        await modeRadio(mode).check();
        await measure('/account', width, theme, mode);
        const preview = page.locator('.appearance-scene-preview .companion-scene');
        await preview.scrollIntoViewIfNeeded();
        for (const toy of buildCompanionArt(theme).toys) {
          const bounds = toyBounds(toy);
          for (const x of [bounds.left, bounds.right]) for (const y of [bounds.top, bounds.bottom]) await dragCorner(preview, toy, x, y);
          await preview.locator('.companion-interaction[data-toy="' + toy.id + '"]').press('ArrowUp');
          assert.equal(await preview.getAttribute('data-settling'), 'true', 'keyboard release starts physics');
        }
        if (theme === 'footballs') {
          const toy = buildCompanionArt(theme).toys[0];
          await dragCorner(preview, toy, toy.hand.x, toy.hand.y);
          assert.equal(await preview.locator('.snack-happy').count(), 1);
          assert.equal(await preview.locator('[data-scene-prop="henny"]').count(), 1);
        }
        await preview.screenshot({ path: path.join(out, theme + '-preview-' + width + '-' + mode + '.webp'), type: 'webp' });
        // Navigate while physics is running: no orphan callbacks or captured toy.
        await navigate('/hub/home');
        await page.locator('.app-atmosphere-floor').waitFor({ state: 'visible' });
        await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
        await measure('/hub/home', width, theme, mode);
        // Audit probes briefly enter the header; restore the intended bottom
        // scroll after measuring so screenshots show the final scene layout.
        await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
        const ground = page.locator('.companion-ground');
        assert.equal(await ground.count(), 1, 'one continuous ground, no repeated chunks');
        const scenes = page.locator('.app-atmosphere-floor .companion-scene');
        assert.equal(await scenes.count(), theme === 'cozy' ? 2 : 1);
        for (let i = 0; i < await scenes.count(); i++) {
          const scene = scenes.nth(i);
          const side = await scene.getAttribute('data-side');
          const toy = buildCompanionArt(theme, side === 'both' ? null : side).toys[0];
          const bounds = toyBounds(toy);
          await dragCorner(scene, toy, bounds.left, bounds.top);
          const before = await scene.locator('[id$="-toy-' + toy.id + '"]').getAttribute('transform');
          await page.waitForTimeout(160);
          assert.notEqual(await scene.locator('[id$="-toy-' + toy.id + '"]').getAttribute('transform'), before, 'release resumes natural movement');
        }
        await page.screenshot({ path: path.join(out, theme + '-page-' + width + '-' + mode + '.webp'), type: 'webp' });
        await navigate('/account#appearance');
      }
      console.log('PASS ' + theme + ' @ ' + width + ': four drag corners, gaze, keyboard, release, page ground, light/dark');
    }
  }
  // Browser integration must stop animating at rest, rather than merely keep
  // calculating the same position forever. Pure tests cover every corner.
  await page.setViewportSize({ width: 390, height: 844 });
  await navigate('/account#appearance');
  for (const theme of ['cozy', 'snow', 'leaves', 'footballs']) {
    await selectTheme(theme);
    const scene = page.locator('.appearance-scene-preview .companion-scene');
    await scene.scrollIntoViewIfNeeded();
    const toy = buildCompanionArt(theme).toys[0], bounds = toyBounds(toy);
    await dragCorner(scene, toy, bounds.right, bounds.top);
    await page.waitForFunction(() => document.querySelector('.appearance-scene-preview .companion-scene')?.dataset.settling === 'false', null, { timeout: 10000 });
    const resting = await scene.locator('[id$="-toy-' + toy.id + '"]').getAttribute('transform');
    await page.waitForTimeout(180);
    assert.equal(await scene.locator('[id$="-toy-' + toy.id + '"]').getAttribute('transform'), resting, 'physics stops at rest');
  }
  await selectTheme('snow');
  const touchScene = page.locator('.appearance-scene-preview .companion-scene');
  await touchScene.scrollIntoViewIfNeeded();
  const snow = buildCompanionArt('snow').toys[0];
  const touchStart = await touchScene.locator('.companion-interaction').boundingBox();
  const touchEnd = await screenPoint(touchScene, snow.x + 30, snow.y - 60);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: touchStart.x + 22, y: touchStart.y + 22, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...touchEnd, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert.equal(await touchScene.getAttribute('data-settling'), 'true', 'touch release starts physics');
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await cdp.detach();
  await selectTheme('cozy');
  await layer('Playful reactions', false);
  assert.equal(await page.locator('.companion-interaction').count(), 0);
  assert.equal(await page.locator('.app-atmosphere-floor [data-buddy]').count(), 2);
  assert.ok(await page.locator('.hub-atmosphere-particle').count() > 0);
  await layer('Companions', false);
  assert.equal(await page.locator('.app-atmosphere-floor').count(), 0);
  assert.ok(await page.locator('.hub-atmosphere-particle').count() > 0);
  await layer('Falling decorations', false);
  assert.equal(await page.locator('.hub-atmosphere-particle, .companion-scene').count(), 0);
  assert.equal(await page.locator('html').getAttribute('data-experience-theme'), 'cozy');
  await layer('Companions', true);
  await layer('Playful reactions', true);
  assert.ok(await page.locator('.companion-interaction').count() > 0, 'reactions work independently of falling decorations');
  const preview = page.locator('.appearance-scene-preview .companion-scene');
  await preview.scrollIntoViewIfNeeded();
  const toy = buildCompanionArt('cozy').toys[0];
  await dragCorner(preview, toy, toy.x + 50, toy.y - 50);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => !document.querySelector('.companion-interaction'));
  assert.equal(await page.locator('.playing, .hub-atmosphere-particle').count(), 0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await layer('Falling decorations', true);
  failPatch = true;
  await page.getByRole('checkbox', { name: /^Companions/ }).uncheck();
  await page.getByRole('alert').filter({ hasText: 'Could not save appearance' }).waitFor();
  assert.equal(await page.getByRole('checkbox', { name: /^Companions/ }).isChecked(), true, 'failed companion save restores state');
  await page.reload();
  await waitSaved();
  assert.equal(await page.getByRole('checkbox', { name: /^Companions/ }).isChecked(), true, 'layers persist on reload');
  await navigate('/hub/home');
  await page.locator('.app-atmosphere-floor').waitFor({ state: 'visible' });
  // A deliberately broken base must fail the new shared layout assertion.
  await page.locator('.companion-ground').evaluate(el => { el.style.width = '50%'; });
  const broken = await page.evaluate(measureScript(), { minTarget: 32, numericRe: NUMERIC_RE.source, barControlSelector: BAR_CONTROL_SELECTOR, tableDeadZonePx: TABLE_DEAD_ZONE_PX, columnPackRatio: COLUMN_PACK_RATIO, gutterSelectors: GUTTER_EDGE_SELECTORS });
  assert.ok(broken.some(result => result.rule === 'atmosphere-ground' && !result.ok));
  await page.locator('.companion-ground').evaluate(el => { el.style.width = ''; });
  assert.deepEqual(errors, []);
  console.log('PASS independent layers, colors only, reduced motion cancellation, save rollback, persistence, ground regression assertion');
} catch (error) {
  await page.screenshot({ path: path.join(out, 'failure.webp'), type: 'webp' }).catch(() => {});
  throw error;
} finally {
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify({ browserErrors: errors, checks: report }, null, 2) + '\n');
  await browser.close();
}
