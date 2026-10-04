/**
 * Built-worker regression: online shell freshness, offline fallback, and
 * recovery while a legacy worker is still controlling the page, and recovery
 * of a rejected lazy module held in the current worker's asset cache.
 * From frontend/: npm run build
 *   npx vite build --config test-fixtures/page-recovery.config.js
 *   node ../scripts/dev/page_recovery_browser.mjs
 * Optional --legacy-dist frontend/recovery-old uses a real old production build
 * instead of the deterministic legacy-worker fixture.
 * Optional --recovery-ref origin/develop bundles that ref's recovery helper to
 * demonstrate the existing failure before exercising the worktree fix.
 * Runs an ephemeral local fixture server; never accesses an API or user data.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  measureScript, minTargetForWidth, NUMERIC_RE, BAR_CONTROL_SELECTOR,
  TABLE_DEAD_ZONE_PX, COLUMN_PACK_RATIO, GUTTER_EDGE_SELECTORS, auditFailed,
} from "./layout_audit.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { chromium } = await import(pathToFileURL(path.join(root, "frontend/node_modules/playwright/index.mjs")));
const { build } = await import(pathToFileURL(path.join(root, "frontend/node_modules/esbuild/lib/main.js")));
const dist = path.join(root, "frontend/dist"), qa = path.join(root, "frontend/qa-dist");
const legacyDistArg = process.argv.indexOf("--legacy-dist");
const legacyDist = legacyDistArg >= 0 ? path.resolve(root, process.argv[legacyDistArg + 1]) : null;
const recoveryRefArg = process.argv.indexOf("--recovery-ref");
const recoveryRef = recoveryRefArg >= 0 ? process.argv[recoveryRefArg + 1] : null;
const helperOverride = recoveryRef
  ? execFileSync("git", ["show", `${recoveryRef}:frontend/src/clientRecovery.js`], { cwd: root, encoding: "utf8" }) : null;
const output = path.resolve(process.env.RECOVERY_REVIEW_DIR || path.join(root, "reviews/page-refresh-recovery"));
const fixture = await readFile(path.join(qa, "test-fixtures/page-recovery.html"), "utf8");
// Bundle the actual boundary/recovery helper with a real lazy import. Keeping
// these assets in memory avoids changing the tracked always-failing fixture.
const assetBundle = await build({
  absWorkingDir: path.join(root, "frontend"),
  stdin: { contents: `import React, { lazy, Suspense } from "react";
    import { createRoot } from "react-dom/client";
    import PageRecoveryBoundary from "./src/PageRecoveryBoundary.jsx";
    import "./src/styles/tokens.css";
    import "./src/styles/product-hierarchy.css";
    const Page = lazy(() => import("healthy-page-fixture"));
    createRoot(document.getElementById("root")).render(
      <PageRecoveryBoundary><Suspense fallback={<p>Opening page…</p>}><Page /></Suspense></PageRecoveryBoundary>);`,
    resolveDir: path.join(root, "frontend"), loader: "jsx" },
  bundle: true, splitting: true, format: "esm", platform: "browser", write: false,
  outdir: "recovery-assets", entryNames: "recovery-app-[hash]", chunkNames: "recovery-page-[hash]",
  minify: true, define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{ name: "recovery-fixtures", setup(bundle) {
    bundle.onResolve({ filter: /^healthy-page-fixture$/ }, () => ({ path: "healthy-page-fixture", namespace: "recovery-fixture" }));
    bundle.onLoad({ filter: /.*/, namespace: "recovery-fixture" }, () => ({
      contents: 'import React from "react"; export default function Page() { return <main><h1>Healthy cached page</h1></main>; }',
      loader: "jsx", resolveDir: path.join(root, "frontend"),
    }));
    if (helperOverride) bundle.onLoad({ filter: /[\\/]clientRecovery\.js$/ }, () => ({
      contents: helperOverride, loader: "js", resolveDir: path.join(root, "frontend/src"),
    }));
  } }],
});
const bundledAssets = new Map(assetBundle.outputFiles.map(file => [`/assets/${path.basename(file.path)}`, file.contents]));
const appAsset = [...bundledAssets.keys()].find(url => /recovery-app-.*\.js$/.test(url));
const lazyAsset = [...bundledAssets].find(([url, contents]) => url.endsWith(".js") && Buffer.from(contents).includes("Healthy cached page"))?.[0];
assert.ok(appAsset && lazyAsset, "The fixture must have distinct app and lazy page assets");
assert.notEqual(appAsset, lazyAsset);
function assetShell() {
  const styles = [...bundledAssets.keys()].filter(url => url.endsWith(".css"))
    .map(url => `<link rel="stylesheet" href="${url}">`).join("");
  return `<!doctype html><html><head><meta name="scoresense-build" content="asset-fixture"><meta name="viewport" content="width=device-width, initial-scale=1">${styles}</head>
    <body><div id="root"></div><script>navigator.serviceWorker.register('/sw.js')</script><script type="module" src="${appAsset}"></script></body></html>`;
}
const checks = [], layoutAudits = [];
const layoutGate = ["type", "selects", "collisions", "grids"];
let shell = "initial", legacy = false, cachedAssets = false, recoveryRequests = 0, recoveryPreflights = 0, lazyNetworkRequests = 0;
// This reproduces the old worker's cached navigation fallback, including its
// /api exclusion. Keep it installed during recovery to prove no SW update is required.
const legacyWorker = `self.addEventListener('install',e=>{e.waitUntil(caches.open('legacy-shell').then(c=>c.add('/hub/home')));self.skipWaiting()});
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',e=>{if(e.request.mode==='navigate'&&!new URL(e.request.url).pathname.startsWith('/api/'))e.respondWith(caches.open('legacy-shell').then(c=>c.match('/hub/home')))})`;
function documentShell(version) {
  return `<!doctype html><html><head><meta name="scoresense-build" content="${version}"></head><body><h1>${version}</h1><script>navigator.serviceWorker.register('/sw.js')</script></body></html>`;
}
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  res.setHeader("Cache-Control", "no-store");
  try {
    let body, type = "text/html";
    if (url.pathname === "/api/client-recovery") {
      if (req.headers["sec-fetch-mode"] === "navigate") recoveryRequests++;
      else recoveryPreflights++;
      const target = url.searchParams.get("return_to") || "/hub/home";
      // Same shell restoration contract tested through the real API in pytest.
      body = (cachedAssets ? assetShell() : documentShell("recovered"))
        .replace("<head>", `<head><script>history.replaceState(history.state,'',${JSON.stringify(target).replaceAll('<', '\\u003c')})</script>`);
    } else if (url.pathname === "/api/client-version") {
      body = JSON.stringify({ version: shell }); type = "application/json";
    } else if (cachedAssets && bundledAssets.has(url.pathname)) {
      body = bundledAssets.get(url.pathname);
      if (url.pathname === lazyAsset) lazyNetworkRequests++;
      type = url.pathname.endsWith(".js") ? "application/javascript" : "text/css";
    } else if (url.pathname === "/sw.js" && legacy) {
      body = legacyDist ? await readFile(path.join(legacyDist, "sw.js")) : legacyWorker;
      type = "application/javascript";
    } else if (url.pathname === "/sw.js" || url.pathname.startsWith("/workbox-") || url.pathname.startsWith("/assets/") || /\.(?:png|ico|js|webmanifest)$/.test(url.pathname)) {
      const filename = decodeURIComponent(url.pathname.slice(1));
      const base = legacy ? (legacyDist || dist) : dist;
      if (legacy && url.pathname.startsWith("/assets/")) {
        try { body = await readFile(path.join(qa, filename)); }
        catch { body = await readFile(path.join(base, filename)); }
      } else body = await readFile(path.join(base, filename));
      type = url.pathname.endsWith(".js") ? "application/javascript" : url.pathname.endsWith(".css") ? "text/css" : "application/octet-stream";
    } else {
      body = cachedAssets ? assetShell() : legacy ? fixture : documentShell(shell);
    }
    res.writeHead(200, { "Content-Type": type }); res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
await mkdir(output, { recursive: true });
try {
  const online = await browser.newContext();
  const page = await online.newPage();
  await page.goto(base + "/hub/home");
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  shell = "current"; // Simulate a deployment before this client updates its worker.
  for (const route of ["/hub/home", "/", "/index.html", "/hub/week?week=4"]) {
    await page.goto(base + route);
    assert.equal(await page.locator("h1").textContent(), "current", route);
    checks.push({ check: "online navigation uses current shell", route, pass: true });
  }
  await online.setOffline(true);
  await page.goto(base + "/hub/home");
  assert.equal(await page.locator("h1").textContent(), "initial");
  checks.push({ check: "offline navigation retains prepared fallback", pass: true });
  await assert.rejects(page.goto(base + "/api/client-version"), /net::ERR_(INTERNET_DISCONNECTED|FAILED)/);
  checks.push({ check: "offline API navigation never receives a cached HTML shell", pass: true });
  await online.close();

  legacy = true;
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const failed = await context.newPage();
    const target = "/hub/home?week=4#lineup";
    await failed.goto(base + target);
    await failed.evaluate(() => navigator.serviceWorker.register("/sw.js"));
    await failed.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    await context.addCookies([{ name: "session-proof", value: "kept", url: base }]);
    await failed.evaluate(() => localStorage.setItem("scoresense-theme", "dark"));
    await failed.reload();
    await failed.getByRole("heading", { name: "This page couldn’t open" }).waitFor();
    checks.push({ check: "legacy ordinary reload repeats error", width, pass: true });
    await failed.screenshot({ path: path.join(output, `recovery-${width}.png`) });
    await failed.getByRole("button", { name: "Reload page" }).click();
    await failed.getByRole("heading", { name: "recovered", exact: true }).waitFor();
    assert.equal(new URL(failed.url()).pathname + new URL(failed.url()).search + new URL(failed.url()).hash, target);
    assert.equal(await failed.evaluate(() => localStorage.getItem("scoresense-theme")), "dark");
    assert.equal((await context.cookies()).find(c => c.name === "session-proof").value, "kept");
    checks.push({ check: "explicit recovery bypasses unchanged legacy worker and preserves URL/storage", width, pass: true });
    await failed.goto(base + "/hub/rules?league=fixture");
    await failed.getByRole("heading", { name: "This page couldn’t open" }).waitFor();
    await failed.getByRole("link", { name: "Go to Fantasy home" }).click();
    await failed.getByRole("heading", { name: "recovered", exact: true }).waitFor();
    assert.equal(new URL(failed.url()).pathname, "/hub/home");
    checks.push({ check: "Fantasy home action also bypasses the legacy cache", width, pass: true });
    await context.close();
  }
  assert.equal(recoveryRequests, 4);

  legacy = false;
  cachedAssets = true;
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const failed = await context.newPage();
    const target = "/hub/home?week=4#lineup";
    await failed.goto(base + target);
    await failed.getByRole("heading", { name: "Healthy cached page", exact: true }).waitFor();
    await failed.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    await context.addCookies([{ name: "session-proof", value: "kept", url: base }]);
    await failed.evaluate(async () => {
      localStorage.setItem("scoresense-theme", "dark");
      localStorage.setItem("scoresense_token", "fixture-account-proof");
      const unrelated = await caches.open("unrelated-user-cache");
      await unrelated.put("/unrelated-proof", new Response("kept"));
    });
    const poison = async () => {
      await failed.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
      await failed.evaluate(async asset => {
        const cache = await caches.open("scoresense-section-assets");
        await cache.put(asset, new Response('throw new Error("Poisoned cached page module"); export default null;', {
          headers: { "Content-Type": "application/javascript" },
        }));
      }, lazyAsset);
    };
    const assertPreserved = async () => {
      const stored = await failed.evaluate(async () => ({
        theme: localStorage.getItem("scoresense-theme"),
        token: localStorage.getItem("scoresense_token"),
        unrelated: await (await caches.open("unrelated-user-cache")).match("/unrelated-proof").then(response => response?.text()),
      }));
      assert.deepEqual(stored, { theme: "dark", token: "fixture-account-proof", unrelated: "kept" });
      assert.equal((await context.cookies()).find(cookie => cookie.name === "session-proof")?.value, "kept");
    };
    await poison();
    const networkBeforeFailure = lazyNetworkRequests;
    for (let attempt = 0; attempt < 2; attempt++) {
      await failed.reload();
      await failed.getByRole("heading", { name: "This page couldn’t open" }).waitFor();
      assert.equal(lazyNetworkRequests, networkBeforeFailure, "Reload should continue using the poisoned worker asset");
    }
    checks.push({ check: "current worker's poisoned lazy asset survives ordinary reloads", width, pass: true });
    const results = await failed.evaluate(measureScript(), {
      minTarget: minTargetForWidth(width),
      numericRe: NUMERIC_RE.source,
      barControlSelector: BAR_CONTROL_SELECTOR,
      tableDeadZonePx: TABLE_DEAD_ZONE_PX,
      columnPackRatio: COLUMN_PACK_RATIO,
      gutterSelectors: GUTTER_EDGE_SELECTORS,
    });
    const audit = { route: "/hub/home (shared recovery fallback)", width, results };
    layoutAudits.push(audit);
    assert.equal(auditFailed([audit], layoutGate), false, `Recovery fallback layout failed at ${width}: ${JSON.stringify(results.filter(row => !row.ok))}`);
    await failed.screenshot({ path: path.join(output, `cached-asset-failure-${width}.png`) });
    await failed.getByRole("button", { name: "Reload page" }).click();
    await failed.getByRole("heading", { name: "Healthy cached page", exact: true }).waitFor();
    assert.equal(new URL(failed.url()).pathname + new URL(failed.url()).search + new URL(failed.url()).hash, target);
    assert.ok(lazyNetworkRequests > networkBeforeFailure, "Recovery must fetch the healthy lazy module from the network");
    await assertPreserved();
    checks.push({ check: "Reload page repairs cached lazy asset and preserves destination/auth/storage", width, pass: true });

    await poison();
    await failed.goto(base + "/hub/rules?league=fixture");
    await failed.getByRole("heading", { name: "This page couldn’t open" }).waitFor();
    const networkBeforeHome = lazyNetworkRequests;
    await failed.getByRole("link", { name: "Go to Fantasy home" }).click();
    await failed.getByRole("heading", { name: "Healthy cached page", exact: true }).waitFor();
    assert.equal(new URL(failed.url()).pathname, "/hub/home");
    assert.ok(lazyNetworkRequests > networkBeforeHome, "Home recovery must also refetch the healthy lazy module");
    await assertPreserved();
    checks.push({ check: "Fantasy home repairs the worker asset cache and preserves auth/storage", width, pass: true });
    await failed.screenshot({ path: path.join(output, `cached-asset-recovered-${width}.png`) });
    await context.close();
  }
  assert.equal(recoveryRequests, 8);
  await writeFile(path.join(output, "browser.json"), JSON.stringify({ checks, layoutGate, layoutAudits, recoveryRequests, recoveryPreflights, recoveryRef, lazyNetworkRequests,
    legacyWorker: legacyDist ? "unchanged production build" : "legacy navigation fixture" }, null, 2) + "\n");
  console.log(JSON.stringify({ passed: checks.length, recoveryRequests,
    layout: layoutAudits.map(({ width, results }) => ({ width, pass: !auditFailed([{ results }], layoutGate),
      failures: results.filter(row => !row.ok) })) }));
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
