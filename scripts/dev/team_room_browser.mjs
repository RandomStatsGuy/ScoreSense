import fs from "node:fs";
import assert from "node:assert/strict";
import {
  measureScript,
  NUMERIC_RE,
  BAR_CONTROL_SELECTOR,
  TABLE_DEAD_ZONE_PX,
  COLUMN_PACK_RATIO,
  GUTTER_EDGE_SELECTORS,
} from "./layout_audit.mjs";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const browser = await chromium.launch({
  headless: true,
  channel: process.env.PLAYWRIGHT_CHANNEL || "msedge",
});
fs.mkdirSync("outputs", { recursive: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const url = "http://127.0.0.1:5173/test-fixtures/team-room.html";
  await page.setViewportSize({ width: 1536, height: 1000 });
  await page.goto(url);
  await page
    .getByRole("button", { name: "Open Malik Nabers's locker", exact: true })
    .click();
  await page.getByText("Edit nickname", { exact: true }).click();
  await page.getByLabel("Player nickname").fill("The Neighborhood II");
  await page
    .getByRole("button", { name: "Save nickname", exact: true })
    .click();
  await page.getByText("Nickname saved.", { exact: true }).waitFor();
  await page.keyboard.press("Escape");
  assert.equal(
    await page
      .getByRole("button", { name: "Open Malik Nabers's locker", exact: true })
      .evaluate((e) => e === document.activeElement),
    true,
  );
  await page.getByRole("button", { name: "Share room", exact: true }).click();
  await page
    .getByRole("button", { name: "Create share link", exact: true })
    .click();
  assert.ok(
    (await page.getByLabel("Room link").inputValue()).includes(
      "/team-room/fixture-share-token",
    ),
  );
  await page
    .getByRole("button", { name: "Turn off sharing", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Create share link", exact: true })
    .waitFor();
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Open Malik Nabers's locker", exact: true })
    .click();
  await page
    .getByRole("button", { name: "View contract", exact: true })
    .click();
  await page.getByRole("dialog").waitFor();
  await page
    .getByRole("button", { name: "Close contract panel", exact: true })
    .click();
  await page.getByRole("button", { name: "Room", exact: true }).click();
  await page.getByRole("button", { name: /^Bench/ }).click();
  await page.getByRole("button", { name: "Open Travis Kelce's locker", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Open Malik Nabers's locker", exact: true }).count(), 0);
  await page.getByRole("button", { name: /^Week:/ }).click();
  await page.getByRole("option", { name: "Week 5", exact: true }).click();
  await page.getByRole("button", { name: "Week: Week 5", exact: true }).waitFor();
  await page.getByRole("button", { name: /^Visit team:/ }).click();
  await page.getByRole("option", { name: "Andrew M · Sunday Rivals", exact: true }).click();
  await page.getByRole("heading", { name: "Sunday Rivals", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Share room", exact: true }).count(), 0);
  assert.ok(await page.evaluate(() => window.__requests.some(r => r.path.includes("/other/room") && r.method === "GET")));
  const reports = [];
  for (const width of [1536, 1280, 1024, 390])
    for (const state of ["pregame", "live", "final"]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`${url}?state=${state}`);
      await page
        .getByRole("button", {
          name: "Open Malik Nabers's locker",
          exact: true,
        })
        .click();
      await page.waitForTimeout(250);
      await page.screenshot({
        path: `outputs/team-room-${state}-${width}.png`,
        fullPage: true,
      });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
        `${state} ${width} overflow`,
      );
      if (state === "live" && [1280, 390].includes(width)) {
        const report = await page.evaluate(measureScript(), {
          minTarget: width === 390 ? 44 : 32,
          numericRe: NUMERIC_RE.source,
          barControlSelector: BAR_CONTROL_SELECTOR,
          tableDeadZonePx: TABLE_DEAD_ZONE_PX,
          columnPackRatio: COLUMN_PACK_RATIO,
          gutterSelectors: GUTTER_EDGE_SELECTORS,
        });
        reports.push({ width, failures: report.filter((r) => !r.ok) });
      }
    }
  await page.goto(`${url}?readonly=1`);
  await page
    .getByRole("button", { name: "Open Malik Nabers's locker", exact: true })
    .click();
  assert.equal(
    await page
      .getByRole("button", { name: "View contract", exact: true })
      .count(),
    0,
  );
  assert.equal(
    await page.getByRole("button", { name: "Share room", exact: true }).count(),
    0,
  );
  assert.equal(await page.getByLabel("Player nickname").count(), 0);
  await page.goto(`${url}?empty=1`);
  await page.getByText("Your lockers are ready.", { exact: false }).waitFor();
  await page.goto(`${url}?error=1`);
  await page.getByRole("button", { name: "Try again", exact: true }).waitFor();
  fs.writeFileSync(
    "outputs/team-room-audit.json",
    JSON.stringify(reports, null, 2),
  );
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ interactions: "passed", reports }, null, 2));
} finally {
  await browser.close();
}
