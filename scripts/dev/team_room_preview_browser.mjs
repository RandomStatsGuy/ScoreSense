// Isolated fixture server: no application API, credentials, or league database.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { measureScript, minTargetForWidth, NUMERIC_RE, BAR_CONTROL_SELECTOR,
  TABLE_DEAD_ZONE_PX, COLUMN_PACK_RATIO, GUTTER_EDGE_SELECTORS } from "../dev/layout_audit.mjs";

const root = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const cases = {
  "room-native": {
    "fixture": "team-room",
    "query": {
      "state": "pregame"
    },
    "ready": {
      "selector": ".team-room-lineup-total"
    },
    "interaction": "room-preview",
    "context": "native / salary / owner / temporary preview"
  },
  "room-sleeper": {
    "fixture": "team-room",
    "query": {
      "state": "pregame",
      "host": "sleeper"
    },
    "ready": {
      "selector": ".team-room-lineup-total"
    },
    "interaction": "room-preview",
    "context": "Sleeper / salary / owner / temporary preview"
  },
  "room-pick-light": {
    "fixture": "team-room",
    "query": {
      "state": "pregame",
      "format": "pick",
      "color": "light"
    },
    "ready": {
      "selector": ".team-room-lineup-total"
    },
    "interaction": "room-preview",
    "context": "native / non-salary / light / owner"
  },
  "room-live": {
    "fixture": "team-room",
    "query": {
      "state": "live"
    },
    "ready": {
      "selector": ".team-room-lineup-total"
    },
    "interaction": "room-preview",
    "context": "native / live / owner"
  },
  "room-readonly": {
    "fixture": "team-room",
    "query": {
      "state": "pregame",
      "readonly": "1"
    },
    "ready": {
      "selector": ".team-room-lineup-total"
    },
    "interaction": "room-readonly",
    "context": "public room / read-only"
  },
  "room-missing": {
    "fixture": "team-room",
    "query": {
      "state": "pregame",
      "missing": "1"
    },
    "ready": {
      "selector": ".team-room-lineup-total"
    },
    "interaction": "room-missing",
    "context": "owner / missing starter and bench projections"
  },
  "room-locked": {
    "fixture": "team-room",
    "query": {
      "state": "pregame",
      "locked": "1"
    },
    "ready": {
      "selector": ".team-room-lineup-total"
    },
    "interaction": "room-locked",
    "context": "owner / started bench player"
  },
  "room-empty": {
    "fixture": "team-room",
    "query": {
      "empty": "1"
    },
    "ready": {
      "text": "Your lockers are ready. Players appear here when your roster is available."
    },
    "interaction": "none",
    "context": "owner / empty room"
  },
  "room-error": {
    "fixture": "team-room",
    "query": {
      "error": "1"
    },
    "ready": {
      "role": "button",
      "name": "Try again"
    },
    "interaction": "none",
    "context": "owner / unavailable room"
  }
};
const map = { areas: {} };
const argv = process.argv.slice(2);
const selected = new Set();
let list = false, smoke = false, workers = 2, output = "outputs/agent/team-room", channel = process.platform === "win32" ? "msedge" : undefined;
for (let i = 0; i < argv.length; i++) {
  const flag = argv[i];
  if (flag === "--list") list = true;
  else if (flag === "--smoke") smoke = true;
  else if (flag === "--workers") {
    workers = Number(argv[++i]);
    if (!Number.isInteger(workers) || workers < 1 || workers > 4) throw new Error("--workers must be an integer from 1 to 4");
  }
  else if (flag === "--case") {
    const id = argv[++i];
    if (!cases[id]) throw new Error(`Unknown scenario: ${id}`);
    selected.add(id);
  } else if (flag === "--area") {
    const area = argv[++i];
    if (!map.areas[area]) throw new Error(`Unknown area: ${area}`);
    for (const id of map.areas[area].scenarios) selected.add(id);
  } else if (flag === "--output") output = argv[++i];
  else if (flag === "--channel") channel = argv[++i] === "chromium" ? undefined : argv[i];
  else throw new Error(`Unknown option: ${flag}`);
}
if (list) {
  console.log(JSON.stringify(cases, null, 2));
} else {
  if (!selected.size) for (const id of Object.keys(cases)) selected.add(id);
  const folder = path.resolve(root, output);
  const relative = path.relative(path.join(root, "outputs/agent"), folder);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Output must stay under outputs/agent/");
  // Reject an existing symlinked parent before creating any reports.
  let ancestor = folder;
  while (ancestor !== root) {
    try { if ((await fs.lstat(ancestor)).isSymbolicLink()) throw new Error("Output may not traverse symlinks"); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    const parent = path.dirname(ancestor);
    if (parent === ancestor) throw new Error("Output does not resolve inside the repository");
    ancestor = parent;
  }
  const require = createRequire(new URL("../../frontend/package.json", import.meta.url));
  const { chromium } = require("playwright");
  const { build } = require("esbuild");
  let server, browser, startupFailure, cancelled = false;
  const reports = [];
  await fs.mkdir(folder, { recursive: true });
  let saves = Promise.resolve();
  const saveReport = status => {
    saves = saves.then(() => fs.writeFile(path.join(folder, "report.json"), JSON.stringify({
      status, reports, smoke, workers, startup_failure: startupFailure || null,
      visual_review: "not performed; inspect screenshots before claiming visual verification",
    }, null, 2)));
    return saves;
  };
  const interrupt = () => { cancelled = true; process.exitCode = 130; void browser?.close().catch(() => {}); };
  process.once("SIGINT", interrupt);
  await saveReport("running");
  try {
    const fixtures = new Set([...selected].map(id => cases[id].fixture));
    const bundleFolder = path.join(folder, "bundles");
    await build({ absWorkingDir: root, entryPoints: [...fixtures].map(name => `frontend/test-fixtures/${name}.jsx`),
      bundle: true, jsx: "automatic", format: "esm", outdir: bundleFolder, logLevel: "error",
      external: ["/art/*", "/fonts/*", "/assets/*"],
      loader: { ".js": "jsx", ".png": "dataurl", ".svg": "dataurl", ".webp": "dataurl", ".woff2": "dataurl",
        ".woff": "dataurl", ".ttf": "dataurl", ".jpg": "dataurl", ".jpeg": "dataurl", ".gif": "dataurl", ".avif": "dataurl", ".ico": "dataurl" },
      define: { "process.env.NODE_ENV": '"production"', "import.meta.env": JSON.stringify({ DEV: false, PROD: true, MODE: "test", BASE_URL: "/" }) } });
    server = createServer(async (request, response) => {
      try {
        const pathname = new URL(request.url, "http://127.0.0.1").pathname;
        const fixture = pathname.match(/^\/test-fixtures\/([a-z-]+)\.html$/)?.[1];
        if (fixture && fixtures.has(fixture)) {
          let html = (await fs.readFile(path.join(root, "frontend/test-fixtures", `${fixture}.html`), "utf8"))
            .replace(/src="[^\"]+\.jsx"/, `src="/__bundles/${fixture}.js"`)
            .replace("</head>", `<link rel="stylesheet" href="/__bundles/${fixture}.css"></head>`);
          if (!html.includes('src="/theme-init.js"')) html = html.replace("</head>", '<script src="/theme-init.js"></script></head>');
          response.writeHead(200, { "Content-Type": "text/html" }); response.end(html); return;
        }
        const bundle = pathname.match(/^\/__bundles\/([a-z-]+)\.(js|css)$/);
        if (bundle && fixtures.has(bundle[1])) {
          response.writeHead(200, { "Content-Type": bundle[2] === "js" ? "text/javascript" : "text/css" });
          response.end(await fs.readFile(path.join(bundleFolder, `${bundle[1]}.${bundle[2]}`))); return;
        }
        // Public images/fonts/theme bootstrap only; never source, secrets or API.
        const publicRoot = path.join(root, "frontend/public");
        const asset = path.resolve(publicRoot, "." + pathname);
        if (asset.startsWith(publicRoot + path.sep) && /\.(?:js|css|png|svg|webp|woff2?|ttf|jpe?g|gif|ico)$/.test(asset)) {
          const real = await fs.realpath(asset);
          if (!real.startsWith(publicRoot + path.sep)) throw new Error("Asset escapes public directory");
          const types = { ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".woff2": "font/woff2" };
          response.writeHead(200, { "Content-Type": types[path.extname(asset)] || "application/octet-stream" });
          response.end(await fs.readFile(real)); return;
        }
        response.writeHead(404); response.end();
      } catch { if (!response.headersSent) response.writeHead(404); response.end(); }
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true, channel });
    const jobs = [...selected].flatMap(id => [1280, 390].map(width => ({ id, width })));
    let nextJob = 0;
    async function worker() {
    while (!cancelled && nextJob < jobs.length) {
      const { id, width } = jobs[nextJob++];
      const spec = cases[id], errors = [], blocked = [];
      const page = await browser.newPage({ viewport: { width, height: 1000 }, serviceWorkers: "block" });
      page.setDefaultTimeout(12000);
      page.setDefaultNavigationTimeout(60000);
      page.on("pageerror", error => errors.push(error.message));
      await page.route("**/*", route => {
        const url = new URL(route.request().url());
        if (url.origin !== base || url.pathname.startsWith("/api/")) {
          blocked.push(url.pathname); return route.abort();
        }
        return route.continue();
      });
      const report = { id, width, context: spec.context, status: "failed", errors, blocked, layout: [],
        layout_status: smoke ? "not_run_smoke" : "not_run", screenshot: null, elapsed_ms: null };
      const started = performance.now();
      try {
        await page.goto(`${base}/test-fixtures/${spec.fixture}.html?${new URLSearchParams(spec.query)}`, { waitUntil: "domcontentloaded" });
          const ready = spec.ready.selector ? page.locator(spec.ready.selector) : spec.ready.text ? page.getByText(spec.ready.text, { exact: spec.ready.exact ?? true }) : page.getByRole(spec.ready.role, { name: spec.ready.name, exact: spec.ready.exact ?? true });
        await ready.first().waitFor();
        if (spec.interaction.startsWith("room-")) {
          if (spec.query.color) {
            assert.equal(await page.locator("html").getAttribute("data-theme"), spec.query.color);
            assert.equal(await page.getByRole("button", { name: "Share room", exact: true }).evaluate(el => getComputedStyle(el).backgroundColor), "rgb(255, 255, 255)");
          }
          const locker = page.getByRole("button", { name: "Open Malik Nabers's locker", exact: true });
          await locker.click();
          await page.getByRole("heading", { name: "“The Neighborhood”", exact: true }).waitFor();
          assert.equal(await page.getByText(/Jersey motion|Hold to swing|Swing jersey/).count(), 0);
          if (spec.interaction === "room-readonly") {
            assert.equal(await page.getByRole("button", { name: "Share room", exact: true }).count(), 0);
            assert.equal(await page.getByText("Edit nickname", { exact: true }).count(), 0);
            assert.equal(await page.locator(".team-room-swap-panel").count(), 0);
          } else if (spec.interaction === "room-locked") {
            assert.equal(await page.locator(".team-room-bench-pick").filter({ hasText: "Josh Downs" }).count(), 0);
          } else if (spec.interaction === "room-missing") {
            assert.equal(await page.locator(".team-room-total-number > strong").textContent(), "—");
            await page.locator(".team-room-bench-pick").filter({ hasText: "Josh Downs" }).click();
            assert.equal(await page.getByRole("button", { name: "Preview swap", exact: true }).isDisabled(), true);
          } else {
            const original = Number(await page.locator(".team-room-total-number > strong").textContent());
            const outgoing = Number(await page.locator(".team-room-detail-score strong").textContent());
            await page.locator(".team-room-bench-pick").filter({ hasText: "Josh Downs" }).click();
            const requestsBefore = await page.evaluate(() => window.__requests);
            const requestCount = requestsBefore.length;
            report.preview_frame_ms = await page.evaluate(async () => {
              const start = performance.now();
              document.querySelector(".team-room-swap-action .btn-primary").click();
              await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
              return Math.round(performance.now() - start);
            });
            await page.getByRole("button", { name: "Open Josh Downs's locker", exact: true }).waitFor();
            assert.equal(await page.locator(".team-room-total-number > strong").textContent(), (original - outgoing + 11.6).toFixed(1));
            assert.equal(await page.evaluate(() => window.__requests.length), requestCount, "Preview added a request");
            assert.deepEqual((await page.evaluate(() => window.__requests)).filter(r => r.method !== "GET"), requestsBefore.filter(r => r.method !== "GET"), "Preview added a league write");
            await page.getByRole("button", { name: "Reset preview", exact: true }).click();
            await locker.click();
            await page.getByText("Edit nickname", { exact: true }).click();
            await page.getByLabel("Player nickname", { exact: true }).fill("Neighborhood favorite");
            await page.getByRole("button", { name: "Save nickname", exact: true }).click();
            await page.getByRole("heading", { name: "“Neighborhood favorite”", exact: true }).waitFor();
            assert.equal(await locker.locator(".team-room-nameplate-nickname").textContent(), "“Neighborhood favorite”");
            if (spec.query.format === "pick") assert.equal(await page.getByRole("button", { name: "View contract", exact: true }).count(), 0);
            await page.keyboard.press("Escape");
            assert.equal(await locker.evaluate(el => el === document.activeElement), true);
            // Keyboard equivalent of the hidden hold gesture; reduced motion stays inert.
            await locker.press("Shift+ArrowLeft");
            assert.equal(await locker.locator(".is-swinging").count(), 1);
            await locker.locator(".is-swinging").waitFor({ state: "detached", timeout: 2500 });
            assert.equal(await locker.locator(".is-swinging").count(), 0);
            await page.emulateMedia({ reducedMotion: "reduce" });
            await locker.press("Shift+ArrowLeft");
            assert.equal(await locker.locator(".is-swinging").count(), 0);
            await page.emulateMedia({ reducedMotion: "no-preference" });
            await locker.click();
            if (spec.interaction === "room-preview" && id === "room-native" && width === 1280) {
              // Keep source and destination visible to exercise the native drag gesture.
              await page.setViewportSize({ width, height: 2400 });
              const flex = page.getByRole("button", { name: "Open Travis Etienne's locker", exact: true });
              await page.getByRole("button", { name: "Compare Josh Downs with a starter", exact: true }).dragTo(flex);
              await page.getByRole("button", { name: "Open Josh Downs's locker", exact: true }).waitFor();
              assert.equal(await page.locator(".team-room-total-number > strong").textContent(), (original - 13 + 11.6).toFixed(1));
              await page.getByRole("button", { name: "Reset preview", exact: true }).click();
              await page.setViewportSize({ width, height: 1000 });
              await locker.click();
              await locker.scrollIntoViewIfNeeded();
              const box = await locker.boundingBox();
              await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
              await page.mouse.down(); await page.waitForTimeout(500);
              assert.equal(await locker.locator(".is-swinging").count(), 1);
              await page.mouse.up();
              assert.equal(await page.getByRole("heading", { name: "“Neighborhood favorite”", exact: true }).count(), 1, "Hold opened/closed the details");
              await page.waitForTimeout(900);
            }
          }
        }
        if (!smoke) {
          report.layout = await page.evaluate(measureScript(), { minTarget: minTargetForWidth(width), numericRe: NUMERIC_RE.source,
            barControlSelector: BAR_CONTROL_SELECTOR, tableDeadZonePx: TABLE_DEAD_ZONE_PX,
            columnPackRatio: COLUMN_PACK_RATIO, gutterSelectors: GUTTER_EDGE_SELECTORS });
          report.layout_status = report.layout.every(row => row.ok) ? "passed" : "failed";
        }
        assert.deepEqual(errors, []);
        assert.deepEqual(blocked.filter(p => p.startsWith("/api/")), [], "Fixture attempted a real API request");
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, "Horizontal page overflow");
        report.status = report.layout.every(row => row.ok) ? "passed" : "layout_failed";
      } catch (error) { report.failure = error.stack || error.message; }
      finally {
        if (!smoke) {
          report.screenshot = path.join(folder, `${id}-${width}.png`);
          await page.screenshot({ path: report.screenshot, fullPage: true, timeout: 5000 }).catch(error => { report.screenshot = null; report.screenshot_error = error.message; });
        }
        report.elapsed_ms = Math.round(performance.now() - started);
        await page.close(); reports.push(report);
        await saveReport("running");
        console.log(`${id} ${width}: ${report.status} (${report.elapsed_ms}ms)${report.failure ? ` (${report.failure})` : ""}`);
      }
    }
    }
    const outcomes = await Promise.allSettled(Array.from({ length: Math.min(workers, jobs.length) }, () => worker()));
    const rejected = outcomes.find(result => result.status === "rejected");
    if (rejected) throw rejected.reason;
  } catch (error) {
    startupFailure = error.message;
    console.error(`Fixture runner unavailable: ${startupFailure}`);
    process.exitCode = 1;
  } finally {
    await browser?.close();
    if (server?.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await saveReport(cancelled ? "interrupted" : startupFailure ? "unavailable" : "completed");
    process.removeListener("SIGINT", interrupt);
  }
  if (!reports.length || reports.some(r => r.status !== "passed")) process.exitCode = 1;
}
