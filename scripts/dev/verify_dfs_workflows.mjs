import assert from "node:assert/strict";
import { chromium } from "playwright";
import fs from "node:fs/promises";
import {
  DFS_WORKSPACE_COPY as C,
  DFS_RESULTS_COPY as R,
} from "../../frontend/src/dfsToolPresentation.js";
import { parseDfsCsv } from "../../frontend/src/dfsCsv.js";
const browser = await chromium.launch({
  headless: true,
  channel: process.platform === "win32" ? "msedge" : undefined,
});
const base =
  process.env.DFS_PREVIEW_URL ||
  "http://127.0.0.1:5176/test-fixtures/dfs-workspace.html";
const file = (name, text) => ({
  name,
  mimeType: "text/csv",
  buffer: Buffer.from(text),
});
const page = await browser.newPage({
  viewport: { width: 1280, height: 1000 },
  acceptDownloads: true,
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(base, { waitUntil: "commit" });
await page
  .getByLabel(C.projections, { exact: true })
  .setInputFiles(
    file("projections.csv", "ID,Proj,Floor,Ceiling,Ownership\n205,9,4,18,15"),
  );
await page
  .getByText("Imported projections for 1 players. Rebuild to apply them.", {
    exact: true,
  })
  .waitFor();
await page.getByRole("button", { name: /^Locked Captain:/ }).click();
await page.getByRole("option", { name: "Blake Corum", exact: true }).click();
await page
  .getByRole("row")
  .filter({ hasText: "Puka Nacua" })
  .getByRole("button", { name: /^Captain max:/ })
  .click();
await page.getByRole("option", { name: "25%", exact: true }).click();
await page.getByRole("button", { name: C.notes, exact: true }).click();
await page
  .locator("textarea")
  .fill("Sample assumption saved before reviewing results.");
await page.getByRole("button", { name: C.build, exact: true }).last().click();
await page.getByText("Built 20 lineups.", { exact: true }).waitFor();
const request = await page.evaluate(() => window.__lastDfsRequest);
assert.equal(request.locked_captain_id, "p5");
assert.equal(request.captain_exposure_limits.p0, 0.25);
assert.equal(request.projection_overrides.p5.proj, 9);
await page.getByRole("button", { name: C.exposureTab, exact: true }).click();
assert.equal(await page.locator(".dfw-center tbody tr").count(), 6);
await page.getByRole("button", { name: C.save, exact: true }).click();
await page.getByRole("button", { name: C.saved, exact: true }).waitFor();
let downloadPromise = page.waitForEvent("download");
await page.getByRole("button", { name: C.download, exact: true }).click();
let download = await downloadPromise;
let rows = parseDfsCsv(await fs.readFile(await download.path(), "utf8"));
assert.equal(rows.length, 21);
assert.equal(rows[0][0], "CPT");
assert.equal(rows[1][0], "Blake Corum (105)");
await page
  .getByLabel(C.template, { exact: true })
  .setInputFiles(
    file(
      "entries.csv",
      "Entry ID,Contest Name,Contest ID,Entry Fee,CPT,FLEX,FLEX,FLEX,FLEX,FLEX\n0001,Sample contest,0010,$5,,,,,,",
    ),
  );
await page.getByRole("button", { name: C.sequential, exact: true }).click();
assert.equal(
  await page
    .getByRole("button", { name: C.entryDownload, exact: true })
    .isDisabled(),
  true,
);
await page.getByLabel(C.verifySlate, { exact: true }).check();
downloadPromise = page.waitForEvent("download");
await page.getByRole("button", { name: C.entryDownload, exact: true }).click();
download = await downloadPromise;
rows = parseDfsCsv(await fs.readFile(await download.path(), "utf8"));
assert.deepEqual(rows[1].slice(0, 4), ["0001", "Sample contest", "0010", "$5"]);
assert.equal(rows[1][4], "Blake Corum (105)");
await page.getByRole("button", { name: C.results, exact: true }).click();
await page.getByText("$710.00", { exact: true }).first().waitFor();
const history = file(
  "history.csv",
  "Entry ID,Contest ID,Contest Name,Date,Entry Fee,Winnings,Points,Rank\n0001,0010,Sample contest,09/10/2026,5,20,110,12",
);
for (let i = 0; i < 2; i++) {
  await page.getByLabel(R.history, { exact: true }).setInputFiles(history);
  await page.getByRole("button", { name: R.preview, exact: true }).click();
  await page.getByRole("button", { name: R.saveImport, exact: true }).click();
  await page.getByText("$730.00", { exact: true }).first().waitFor();
}
await page.getByText("$605.00", { exact: true }).first().waitFor();
await page
  .locator(".dfw-entry-list")
  .getByRole("button")
  .filter({ hasText: "Sample contest" })
  .click();
assert.match(
  await page.locator(".dfw-results-grid").last().innerText(),
  /90\.9|91\.0/,
);
await page.locator("textarea").fill("Sample postgame note.");
await page.getByRole("button", { name: R.saveNote, exact: true }).click();
await page.getByRole("button", { name: C.build, exact: true }).first().click();
await page.getByRole("button", { name: /^Week:/ }).click();
await page.getByRole("option", { name: "2", exact: true }).click();
await page
  .getByRole("button", { name: `Locked Captain: ${C.anyCaptain}`, exact: true })
  .waitFor();
for (const state of ["loading", "empty", "error", "readonly"]) {
  await page.goto(`${base}?state=${state}`, { waitUntil: "commit" });
  if (state === "loading") {
    await page.getByLabel(C.loading).first().waitFor();
    await page.getByRole("row").filter({hasText:"Puka Nacua"}).waitFor();
  } else if (state === "empty") {
    await page.getByText(C.noPlayers, { exact: true }).waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: C.build, exact: true })
        .last()
        .isDisabled(),
      true,
    );
    await page.getByRole("button", { name: C.results, exact: true }).click();
    await page.getByText(R.empty, { exact: true }).waitFor();
  } else if (state === "error") {
    await page
      .getByRole("alert")
      .filter({ hasText: "Sample salary service failure" })
      .waitFor();
  } else {
    await page.getByRole("button", { name: C.results, exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "Sign in" }).waitFor();
  }
}
assert.deepEqual(errors, []);
await browser.close();
console.log(
  "PASS: projection/Captain controls, snapshots, both CSV downloads, reserved-entry mapping, idempotent history import, review notes, slate reset, empty/error/read-only states.",
);
