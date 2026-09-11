import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(
  new URL("../../frontend/package.json", import.meta.url),
);
const { chromium } = require("playwright");
import {
  measureScript,
  NUMERIC_RE,
  BAR_CONTROL_SELECTOR,
  TABLE_DEAD_ZONE_PX,
  COLUMN_PACK_RATIO,
  GUTTER_EDGE_SELECTORS,
} from "./layout_audit.mjs";
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const base = process.env.GAME_CENTER_PREVIEW_URL || "http://127.0.0.1:5178";
await fs.mkdir("outputs/game-center", { recursive: true });
const reports = [];
try {
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${base}/test-fixtures/game-center.html`, {waitUntil:"domcontentloaded"});
    await page.locator(".gc-room-feature").waitFor();
    await page.waitForFunction(
      () => document.querySelectorAll(".gc-room-banner-art img").length === 2,
    );
    await page.screenshot({
      path: `outputs/game-center/implemented-b-${width}.png`,
      fullPage: true,
    });
    const audit = await page.evaluate(measureScript(), {
      minTarget: width === 390 ? 44 : 32,
      numericRe: NUMERIC_RE.source,
      barControlSelector: BAR_CONTROL_SELECTOR,
      tableDeadZonePx: TABLE_DEAD_ZONE_PX,
      columnPackRatio: COLUMN_PACK_RATIO,
      gutterSelectors: GUTTER_EDGE_SELECTORS,
    });
    reports.push({ width, route: "/hub/game", audit });
    console.log(
      width,
      audit.filter((x) => !x.ok),
    );
    await page
      .getByRole("button", {
        name: "RB: Blake Corum versus Bucky Irving",
        exact: true,
      })
      .click();
    assert.equal(
      await page.locator(".gc-room-feature h2").first().textContent(),
      "Blake Corum",
    );
    await page.getByRole("button", { name: "Josh C", exact: true }).click();
    assert.equal(
      await page.locator(".gc-room-selected h2").textContent(),
      "Bucky Irving",
    );
    await page.getByRole("button", { name: "Bench", exact: true }).click();
    assert.match(
      await page.locator(".gc-room-bench").textContent(),
      /Jayden Daniels/,
    );
    await page.getByRole("button", { name: "League", exact: true }).click();
    assert.equal(await page.locator(".gc-room-feature").count(), 0);
    await page
      .getByRole("button", { name: "Review lineup", exact: true })
      .click();
    assert.equal(
      await page.locator("#navigation-result").textContent(),
      "week",
    );
    await page.getByRole("button", { name: "Next week", exact: true }).click();
    await page.waitForFunction(() =>
      document
        .querySelector(".gc-room-heading p")
        .textContent.includes("Week 2"),
    );
    assert.equal(errors.length, 0, errors.join("\n"));
    await page.close();
  }
  const p = await browser.newPage();
  for (const state of ["empty", "error", "loading", "pregame", "final"]) {
    await p.goto(`${base}/test-fixtures/game-center.html?state=${state}`, {waitUntil:"domcontentloaded"});
    if (state === "loading")
      await p.getByLabel("Loading matchups", { exact: true }).first().waitFor();
    else if (state === "error")
      await p.getByRole("button", { name: "Try again" }).waitFor();
    else if (state === "empty") await p.locator(".gc-room-empty").waitFor();
    else await p.locator(".gc-room-feature").waitFor();
  }
  await p.goto(
    `${base}/test-fixtures/game-center.html?matchupWeek=6&matchupTeam=other&noart=1`,
  );
  await p.locator(".gc-room-feature").waitFor();
  assert.match(await p.locator(".gc-room-heading p").textContent(), /Week 6/);
  assert.equal(
    await p.locator(".gc-room-team h2").first().textContent(),
    "Thanks noob noob",
  );
  assert.equal(await p.locator(".gc-room-banner-art").count(), 0);
  await p.goto(`${base}/test-fixtures/team-room.html`, {waitUntil:"domcontentloaded"});
  await p.locator("a.team-room-scoreboard").waitFor();
  assert.equal(
    await p.locator("a.team-room-scoreboard").getAttribute("href"),
    "/hub/game?matchupWeek=6&matchupTeam=mine",
  );
  for (const width of [1280, 390]) {
    await p.setViewportSize({ width, height: 1000 });
    const audit = await p.evaluate(measureScript(), {
      minTarget: width === 390 ? 44 : 32,
      numericRe: NUMERIC_RE.source,
      barControlSelector: BAR_CONTROL_SELECTOR,
      tableDeadZonePx: TABLE_DEAD_ZONE_PX,
      columnPackRatio: COLUMN_PACK_RATIO,
      gutterSelectors: GUTTER_EDGE_SELECTORS,
    });
    reports.push({ width, route: "/hub/roster", audit });
    console.log(
      "roster",
      width,
      audit.filter((x) => !x.ok),
    );
    await p.screenshot({
      path: `outputs/game-center/my-team-link-${width}.png`,
      fullPage: true,
    });
  }
  // Follow the actual native link with the production Game center entry mounted at its destination.
  await p.route(`${base}/hub/game**`, async route => {
    await route.fulfill({ response: await route.fetch({url: `${base}/test-fixtures/game-center.html`}) });
  });
  await p.locator("a.team-room-scoreboard").focus();
  await p.keyboard.press("Enter");
  await p.waitForURL("**/hub/game?matchupWeek=6&matchupTeam=mine");
  await p.locator(".gc-room-feature").waitFor();
  assert.match(await p.locator(".gc-room-heading p").textContent(), /Week 6/);
  await p.goto(`${base}/test-fixtures/team-room.html?readonly=1`, {waitUntil:"domcontentloaded"});
  await p.locator(".team-room-scoreboard").waitFor();
  assert.equal(await p.locator("a.team-room-scoreboard").count(), 0);
  await fs.writeFile(
    "outputs/game-center/implementation-audit.json",
    JSON.stringify(reports, null, 2),
  );
  assert.equal(
    reports.flatMap((r) => r.audit).filter((x) => !x.ok).length,
    0,
    "Layout audit failed",
  );
  console.log(
    "Game center controls, state variants, personalization, team/week links, public-room gate passed",
  );
} finally {
  await browser.close();
}
