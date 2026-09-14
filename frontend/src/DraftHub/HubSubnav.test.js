import assert from "node:assert/strict";
import test from "node:test";
import { filterHubSubviews } from "./hubSubnav.js";

test("salary-cap leagues keep Cap in Fantasy nav", () => {
  const ids = filterHubSubviews({
    mode: "league",
    league_id: "L1",
    is_commissioner: true,
    capabilities: { uses_salaries: true, uses_contracts: true, acquisition_mode: "bid" },
  }).map((item) => item.id);
  assert.ok(ids.includes("planner"));
  assert.equal(
    filterHubSubviews({ mode: "league", league_id: "L1" }).find((item) => item.id === "trades")?.hint,
    "Cap-checked deals",
  );
});

test("no-money leagues hide Cap and drop financial hints", () => {
  const views = filterHubSubviews({
    mode: "league",
    league_id: "L1",
    is_commissioner: true,
    capabilities: { uses_salaries: false, uses_contracts: false, acquisition_mode: "priority" },
  });
  const ids = views.map((item) => item.id);
  assert.equal(ids.includes("planner"), false);
  assert.ok(ids.includes("available"));
  assert.equal(views.find((item) => item.id === "trades")?.hint, "Roster-checked deals");
  assert.equal(views.find((item) => item.id === "office")?.hint, "Members and access");
});
