import assert from "node:assert/strict";
import test from "node:test";
import { filterHubSubviews, primaryHubSubviews, secondaryHubSubviews } from "./hubSubnav.js";

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

test("both league types share three in-season destinations and retain permitted secondary tools", () => {
  for (const uses_salaries of [true, false]) {
    const context = {mode:"league", league_id:"L", draft_completed:true, is_commissioner:false,
      capabilities:{uses_salaries, uses_contracts:uses_salaries}};
    assert.deepEqual(primaryHubSubviews(context).map(item => item.id), ["week", "roster", "available"]);
    const secondary = secondaryHubSubviews(context).map(item => item.id);
    assert.equal(secondary.includes("planner"), uses_salaries);
    assert.equal(secondary.includes("office"), false);
    assert.equal(secondary.includes("game"), false);
    assert.ok(secondary.includes("rosters") && secondary.includes("trades"));
  }
});

test("draft and strategy remain primary before the draft", () => {
  assert.deepEqual(primaryHubSubviews({mode:"league", league_id:"L", draft_completed:false}).map(item => item.id),
    ["home", "room", "value", "roster", "available"]);
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


test("draft-only destinations follow the selected league phase and Home leads League", () => {
  for (const uses_salaries of [true, false]) {
    for (const draft_completed of [false, true, false]) {
      const context = { mode: "league", league_id: "L", draft_completed, is_commissioner: true,
        capabilities: { uses_salaries, uses_contracts: uses_salaries } };
      const visible = filterHubSubviews(context).map(item => item.id);
      assert.equal(visible.includes("value"), !draft_completed);
      assert.equal(visible.includes("room"), !draft_completed);
      assert.equal(secondaryHubSubviews(context)[0].id, "home");
      for (const id of ["home", "vibes", "rosters", "trades", "rules", "office", "insights"]) {
        assert.ok(visible.includes(id), `${id} remains useful after drafting`);
      }
    }
  }
});

test("solo practice retains draft tools without exposing league-only destinations", () => {
  const ids = filterHubSubviews({ mode: "solo", draft_completed: true }).map(item => item.id);
  assert.ok(ids.includes("value") && ids.includes("room"));
  assert.equal(ids.includes("office"), false);
  assert.equal(ids.includes("rosters"), false);
});
