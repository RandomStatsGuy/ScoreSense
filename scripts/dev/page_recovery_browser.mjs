/**
 * Built-worker regression: online shell freshness, offline fallback, and
 * recovery while a legacy worker is still controlling the page.
 * From frontend/: npm run build
 *   npx vite build --config test-fixtures/page-recovery.config.js
 *   node ../scripts/dev/page_recovery_browser.mjs
 * Optional --legacy-dist frontend/recovery-old uses a real old production build
 * instead of the deterministic legacy-worker fixture.
 * Runs an ephemeral local fixture server; never accesses an API or user data.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { chromium } = await import(pathToFileURL(path.join(root, "frontend/node_modules/playwright/index.mjs")));
const dist = path.join(root, "frontend/dist"), qa = path.join(root, "frontend/qa-dist");
const legacyDistArg = process.argv.indexOf("--legacy-dist");
const legacyDist = legacyDistArg >= 0 ? path.resolve(root, process.argv[legacyDistArg + 1]) : null;
const output = path.resolve(process.env.RECOVERY_REVIEW_DIR || path.join(root, "reviews/page-refresh-recovery"));
const fixture = await readFile(path.join(qa, "test-fixtures/page-recovery.html"), "utf8");
const checks = [];
let shell = "initial", legacy = false, recoveryRequests = 0;
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
      recoveryRequests++;
      const target = url.searchParams.get("return_to") || "/hub/home";
      // Same shell restoration contract tested through the real API in pytest.
      body = documentShell("recovered").replace("<head>", `<head><script>history.replaceState(history.state,'',${JSON.stringify(target).replaceAll('<', '\\u003c')})</script>`);
    } else if (url.pathname === "/api/client-version") {
      body = JSON.stringify({ version: shell }); type = "application/json";
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
      body = legacy ? fixture : documentShell(shell);
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
  await writeFile(path.join(output, "browser.json"), JSON.stringify({ checks, recoveryRequests,
    legacyWorker: legacyDist ? "unchanged production build" : "legacy navigation fixture" }, null, 2) + "\n");
  console.log(JSON.stringify({ passed: checks.length, recoveryRequests }));
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
