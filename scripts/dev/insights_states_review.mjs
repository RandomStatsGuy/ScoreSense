// Browser-only response fixtures; never write sample contracts to the app database.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(new URL("../../frontend/package.json", import.meta.url));
const { chromium } = require("playwright");
const league = "09c9f8c3-14ae-44e3-9de0-ea7b68562f5d";
const overview = await (await fetch(`http://127.0.0.1:8000/api/hub/league/${league}/insights/overview`)).json();
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 852 }, serviceWorkers: "block" });
  await page.route("**/api/hub/workspace*", async (route) => {
    const response = await route.fetch(); const data = await response.json();
    await route.fulfill({ response, json: { ...data, hub_context: overview.hub_context, insights_overview: undefined } });
  });
  let release;
  const pending = new Promise((resolve) => { release = resolve; setTimeout(resolve, 5000); });
  await page.route("**/api/hub/league/*/insights/overview*", async (route) => {
    await pending;
    await route.fulfill({ json: { ...overview, landing: { available: false, seasons: [], hint: "No saved history for this league." } } });
  });
  await page.goto("http://127.0.0.1:5173/hub/insights/overview", { waitUntil: "domcontentloaded" });
  await page.locator('.hub-insights-skeleton[aria-busy="true"]').waitFor();
  assert.equal(await page.getByRole("navigation", { name: "Insights", exact: true }).getByRole("button").count(), 5);
  release();
  await page.getByText("No saved history for this league.", { exact: true }).waitFor();
  await page.unroute("**/api/hub/league/*/insights/overview*");
  let releaseContracts;
  let contractRequests = 0;
  await page.route("**/api/hub/league/*/insights/contracts*", async (route) => {
    contractRequests += 1;
    await new Promise((resolve) => { releaseContracts = resolve; setTimeout(resolve, 10000); });
    await route.fulfill({ json: { ...overview, contracts: { seasons: [2021, 2022, 2023, 2024, 2025], rows: [
      { deal_id: "qa-one", season: 2023, player_name: "QA receiver", position: "WR", owner_name: "Manager", salary: 10, points: 100, weeks_saved: 17 },
      { deal_id: "qa-two", season: 2024, player_name: "QA quarterback", position: "QB", owner_name: "Manager", salary: 30, points: 0, weeks_saved: 17 },
    ] } } });
  });
  await page.getByRole("navigation", { name: "Insights", exact: true }).getByRole("button", { name: "Contracts", exact: true }).click();
  await page.locator(".hub-insights-skeleton, .hub-insights-contract-list .hub-insights-skeleton-block").first().waitFor();
  releaseContracts();
  await page.getByText("QA receiver").first().waitFor();
  await page.getByRole("button", { name: "Contract position: All positions", exact: true }).click();
  await page.getByRole("option", { name: "WR", exact: true }).click();
  assert.equal(await page.getByText("QA quarterback").count(), 0);
  await page.locator(".hub-insights-period summary").click();
  await page.getByRole("slider", { name: "From year", exact: true }).focus();
  await page.keyboard.press("Home"); await page.keyboard.press("ArrowRight");
  await page.getByRole("slider", { name: "Through year", exact: true }).focus();
  await page.keyboard.press("End"); await page.keyboard.press("ArrowLeft");
  await page.getByRole("button", { name: "Apply range", exact: true }).click();
  assert.equal(await page.locator(".hub-insights-period summary strong").textContent(), "2022–2024");
  assert.equal(contractRequests, 1);
  await page.route("**/api/hub/league/*/insights/overview*", (route) => route.fulfill({ status: 503, json: { detail: "History temporarily unavailable" } }));
  await page.getByRole("button", { name: "Refresh history", exact: true }).click();
  await page.getByText("History temporarily unavailable", { exact: true }).waitFor();
  assert.equal(contractRequests, 1, "A failed history refresh must not clear its error by loading Contracts");
  console.log("PASS: loading, empty, populated ranking, position filter, keyboard range, no range requests, refresh error");
} finally { await browser.close(); }
