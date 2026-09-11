#!/usr/bin/env node
/**
 * Local-only performance regression checks with synthetic API responses.
 * Build first: npm run build --prefix frontend
 * Smoke + service worker: node scripts/dev/page_load_browser.mjs
 * Screenshots/style comparison: node scripts/dev/page_load_browser.mjs <baseline-dist-directory>
 * Output defaults to .perf-check (override PERF_AUDIT_OUTPUT).
 * Requires frontend Playwright + Chromium; PLAYWRIGHT_MODULE can select an isolated install.
 * The visual check reports existing layout-audit findings separately from regressions.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const playwrightPath =
  process.env.PLAYWRIGHT_MODULE ||
  path.join(root, "frontend/node_modules/playwright/index.mjs");
const { chromium } = await import(pathToFileURL(playwrightPath).href);
import {
  measureScript,
  NUMERIC_RE,
  BAR_CONTROL_SELECTOR,
  TABLE_DEAD_ZONE_PX,
  COLUMN_PACK_RATIO,
  GUTTER_EDGE_SELECTORS,
} from "./layout_audit.mjs";
const here = process.env.PERF_AUDIT_OUTPUT || path.join(root, ".perf-check");
fs.mkdirSync(here, { recursive: true });
const players = Array.from({ length: 12 }, (_, i) => ({
  player_id: "p" + i,
  Player: ["Josh Allen", "Patrick Mahomes", "Lamar Jackson"][i % 3] + " " + i,
  Team: ["BUF", "KC", "BAL"][i % 3],
  Position: "QB",
  "Season Proj": 300 - i * 5,
  P50: 22 - i * 0.4,
  P10: 12,
  P90: 30,
  pred: 22 - i * 0.4,
  pred_p10: 12,
  pred_p50: 22 - i * 0.4,
  pred_p90: 30,
  position_rank: i + 1,
  adp_rank: i + 2,
  value_vs_adp: 1,
}));
const meta = {
  default_season: 2026,
  default_week: 1,
  seasons: [2026],
  weeks: [1, 2],
  season: 2026,
  week: 1,
  positions: ["qb", "rb", "wr"],
  count: 12,
  with_adp: 12,
};
const ctx = {
  league_id: "fixture",
  league_name: "Audit League",
  season: 2026,
  team_id: "t1",
  team_name: "North",
  owner_name: "Alex",
  is_commissioner: true,
  can_manage: true,
  rules: {
    salary_cap: 200,
    team_count: 12,
    roster: {
      qb: { min: 1, max: 3 },
      rb: { min: 2, max: 8 },
      wr: { min: 2, max: 8 },
      te: { min: 1, max: 3 },
      flex: { min: 1, max: 2 },
    },
    contracts: {},
    auction: {},
  },
  test_mode: false,
};
function api(url) {
  const p = new URL(url, "http://local").pathname;
  if (p === "/api/auth/config")
    return {
      auth_required: false,
      hub_auth_required: false,
      google_configured: true,
      terms_url: "/terms",
      privacy_url: "/privacy",
    };
  if (p === "/api/auth/me")
    return {
      authenticated: true,
      user: {
        id: "audit",
        email: "audit@local.test",
        display_name: "Alex",
        name: "Alex",
        is_admin: true,
        email_verified: true,
        terms_accepted: true,
      },
    };
  if (p === "/api/admin/overview")
    return {
      native_user_count: 42,
      live_league_count: 8,
      test_league_count: 2,
      bot_sub_count: 12,
    };
  if (p === "/api/admin/users") return { accounts: [], system_subs: [] };
  if (p.includes("/meta/")) return meta;
  if (p === "/api/bestball/board") return { players, meta };
  if (p === "/api/predict/compare")
    return {
      players: players
        .slice(0, 2)
        .map((p) => ({
          player_id: p.player_id,
          name: p.Player,
          team: p.Team,
          position: p.Position,
          p10: 12,
          p50: 22,
          p90: 30,
        })),
      comparison: {},
      meta,
    };
  if (p.startsWith("/api/predict/"))
    return { projections: players, meta, changes: [] };
  if (p.startsWith("/api/draft/"))
    return { projections: players, players, meta };
  if (p === "/api/hub/workspace")
    return {
      hub_context: ctx,
      memberships: [{ ...ctx, role: "commissioner" }],
    };
  if (p === "/api/hub/context") return ctx;
  if (p === "/api/hub/presets") return { presets: [] };
  if (p.includes("value-sheet") || p.includes("draft-pool"))
    return { players, meta, season: 2026 };
  if (p.includes("/roster")) return { roster: [], teams: [], players: [] };
  if (p.includes("/cap-sheet"))
    return { rows: [], summary: { salary_cap: 200, remaining: 200 } };
  if (p.includes("/player/"))
    return {
      player: {
        player_id: "p0",
        name: "Josh Allen 0",
        team: "BUF",
        position: "QB",
      },
      projection: { p10: 12, p50: 22, p90: 30 },
      meta,
    };
  if (p.includes("injuries")) return { injuries: [] };
  if (p.includes("refresh/status")) return { running: false };
  if (p.includes("status")) return { running: false };
  return {};
}
function serve(root, port) {
  return new Promise((resolve) => {
    const server = http
      .createServer((req, res) => {
        if (req.url.startsWith("/api/")) {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(api(req.url)));
          return;
        }
        let f = path.join(root, new URL(req.url, "http://local").pathname);
        if (!fs.existsSync(f) || fs.statSync(f).isDirectory())
          f = path.join(root, "index.html");
        const ext = path.extname(f);
        res.setHeader(
          "Content-Type",
          {
            ".html": "text/html",
            ".js": "application/javascript",
            ".css": "text/css",
            ".svg": "image/svg+xml",
            ".png": "image/png",
            ".json": "application/json",
            ".webmanifest": "application/manifest+json",
          }[ext] || "application/octet-stream",
        );
        res.end(fs.readFileSync(f));
      })
      .listen(port, "127.0.0.1", () => resolve(server));
  });
}

if (process.argv[2]) {
  const servers = [
    await serve(path.resolve(process.argv[2]), 5195),
    await serve(path.join(root, "frontend/dist"), 5196),
  ];
  const browser = await chromium.launch({ headless: true });
  const routes = [
    "/projections/weekly",
    "/projections/weekly#inspector",
    "/projections/weekly?compare=p0,p1&cmp=1",
    "/projections/season",
    "/tools/best-ball",
    "/tools/dfs",
    "/tools/mock-draft",
    "/admin",
    "/account",
    "/login",
    "/register",
    "/report",
    "/terms",
    "/hub/home",
    "/hub/draft",
    "/hub/free-agents",
    "/hub/strategy",
    "/hub/vibes",
    "/hub/roster",
    "/hub/cap",
    "/hub/trades",
    "/hub/insights/overview",
  ];
  const report = [];
  try {
    for (const width of [1280, 390])
      for (const route of routes) {
        const pair = [];
        for (const [i, port] of [5195, 5196].entries()) {
          console.log("start", route, width, port);
          const context = await browser.newContext({
            viewport: { width, height: 900 },
            serviceWorkers: "block",
            reducedMotion: "reduce",
          });
          await context.route("**/*", (r) => {
            if (
              ["/login", "/register"].includes(route) &&
              r.request().url().endsWith("/api/auth/me")
            )
              return r.fulfill({ json: { authenticated: false } });
            return new URL(r.request().url()).hostname === "127.0.0.1"
              ? r.continue()
              : r.abort();
          });
          const page = await context.newPage();
          const errors = [];
          page.on("pageerror", (e) => errors.push(e.message));
          const requests = [];
          page.on("request", (r) => requests.push(r.url()));
          await page.clock.setFixedTime(new Date("2026-09-11T17:00:00Z"));
          await page.goto(`http://127.0.0.1:${port}${route}`, {
            waitUntil: "domcontentloaded",
          });
          await page.waitForTimeout(600);
          if (route.endsWith("#inspector")) {
            if (width === 390) {
              await page.locator(".mobile-player-card-header").first().click();
              await page
                .getByRole("button", { name: "Details", exact: true })
                .first()
                .click();
            } else
              await page
                .getByRole("button", { name: "Open Josh Allen 0 details" })
                .first()
                .click();
            await page.waitForTimeout(600);
          }
          await page.addStyleTag({
            content:
              "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}",
          });
          const name =
            route.replaceAll("/", "_").replace(/[?#,=&]/g, "_") +
            "-" +
            width +
            "-" +
            i;
          await page.screenshot({
            path: path.join(here, name + ".png"),
            fullPage: true,
          });
          const styles = await page.evaluate(() =>
            [...document.body.querySelectorAll("*")]
              .filter(
                (e) =>
                  e.getBoundingClientRect().width &&
                  e.getBoundingClientRect().height,
              )
              .map((e) => {
                const s = getComputedStyle(e);
                return {
                  tag: e.tagName,
                  cls: e.getAttribute("class"),
                  text: e.childElementCount ? null : e.textContent,
                  css: Object.fromEntries(
                    [...s]
                      .filter((p) => !p.startsWith("--"))
                      .map((p) => [p, s.getPropertyValue(p)]),
                  ),
                };
              }),
          );
          const audit = await page.evaluate(measureScript(), {
            minTarget: width === 390 ? 44 : 32,
            numericRe: NUMERIC_RE.source,
            barControlSelector: BAR_CONTROL_SELECTOR,
            tableDeadZonePx: TABLE_DEAD_ZONE_PX,
            columnPackRatio: COLUMN_PACK_RATIO,
            gutterSelectors: GUTTER_EDGE_SELECTORS,
          });
          pair.push({ styles, errors, audit, requests });
          await context.close();
        }
        const differences = [];
        if (pair[0].styles.length !== pair[1].styles.length)
          differences.push({
            count: [pair[0].styles.length, pair[1].styles.length],
          });
        else
          for (let j = 0; j < pair[0].styles.length; j++) {
            const a = pair[0].styles[j],
              b = pair[1].styles[j];
            const props = Object.keys(a.css).filter(
              (p) => a.css[p] !== b.css[p],
            );
            if (props.length)
              differences.push({
                index: j,
                cls: a.cls,
                props: Object.fromEntries(
                  props.map((p) => [p, [a.css[p], b.css[p]]]),
                ),
              });
          }
        report.push({
          route,
          width,
          differences,
          errors: pair.map((p) => p.errors),
          audits: pair.map((p) => p.audit),
        });
        console.log(
          route,
          width,
          "differences",
          differences.length,
          "errors",
          pair.map((p) => p.errors.length),
        );
        if (route === "/projections/weekly")
          fs.writeFileSync(
            path.join(here, "requests-" + width + ".json"),
            JSON.stringify(
              pair.map((p) => p.requests),
              null,
              2,
            ),
          );
      }
  } finally {
    fs.writeFileSync(
      path.join(here, "visual-report.json"),
      JSON.stringify(report, null, 2),
    );
    await browser.close();
    servers.forEach((s) => s.close());
  }

  if (
    report.some(
      (row) =>
        row.differences.length || row.errors.some((errors) => errors.length),
    )
  )
    process.exitCode = 1;
} else {
  const assert = (await import("node:assert/strict")).default;
  const server = await serve(path.join(root, "frontend/dist"), 5197);
  const requests = [];
  server.on("request", (req) => requests.push(req.url));
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    await context.route("**/*", (r) =>
      new URL(r.request().url()).hostname === "127.0.0.1"
        ? r.continue()
        : r.abort(),
    );
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("http://127.0.0.1:5197/projections/weekly", {
      waitUntil: "domcontentloaded",
    });
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForTimeout(500);
    const initial = [...requests];
    assert(
      !initial.some(
        (u) =>
          u.startsWith("/assets/") &&
          /AdminPortal-|BestBallBoard-|PlayerCardModal-|AccountSettingsPage-|fantasy-|AccountAuth-|auth-session-/.test(
            u,
          ),
      ),
      "Optional assets downloaded during startup",
    );
    const nav = async (route) => {
      await page.evaluate((route) => {
        history.pushState({}, "", route);
        dispatchEvent(new PopStateEvent("popstate"));
      }, route);
      await page.waitForTimeout(650);
    };
    await nav("/tools/best-ball");
    await page.locator(".bestball-board").waitFor();
    assert(
      requests.some((u) => /BestBallBoard-/.test(u)),
      "Best ball did not load on demand",
    );
    await nav("/admin");
    await page.locator(".admin-portal").waitFor();
    await nav("/account");
    await page.locator(".account-settings-page").waitFor();
    await nav("/hub/home");
    await page.locator(".draft-hub").waitFor();
    await nav("/projections/weekly");
    await page
      .getByRole("button", { name: "Open Josh Allen 0 details" })
      .first()
      .click();
    await page.locator(".player-inspector").waitFor();
    await page.waitForTimeout(500);
    assert(
      requests.some((u) => /PlayerCardModal-/.test(u)),
      "Player details did not load on demand",
    );
    await page.keyboard.press("Escape");
    assert.equal(await page.locator(".player-inspector").count(), 0);
    await nav("/projections/weekly?compare=p0,p1&cmp=1");
    await page.locator(".player-compare-head").waitFor();
    const keys = await page.evaluate(async () => {
      const cache = await caches.open("scoresense-section-assets");
      return (await cache.keys()).map((r) => r.url);
    });
    assert(
      keys.some((u) => /BestBallBoard-/.test(u)),
      "Visited section not cached",
    );
    assert.equal(errors.length, 0, errors.join("\n"));
    fs.writeFileSync(
      path.join(here, "behavior-report.json"),
      JSON.stringify(
        { initial, requests, cachedSectionAssets: keys, errors },
        null,
        2,
      ),
    );
    console.log(
      "PASS: startup deferral, service-worker installation, section navigation, player open/Escape, compare, and visited-asset caching.",
    );
    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
}
