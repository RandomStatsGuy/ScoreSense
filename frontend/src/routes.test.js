import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAppPath,
  buildFilterSearchParams,
  parseAppPath,
  parseFilterParams,
  stripOneShotAuthParams,
  stripProjectionParams,
} from "./routes.js";

test("stripProjectionParams drops projections filters but keeps hub params", () => {
  const params = stripProjectionParams(new URLSearchParams(
    "pos=qb&season=2026&week=1&fromWeek=1&teams=KC,BUF&q=hill&movers=1&cmp=1&compare=a,b&draftSeason=2026&rosSeason=2026&player=00-123",
  ));
  assert.equal(params.get("player"), "00-123");
  assert.equal([...params.keys()].length, 1);
});

test("stripOneShotAuthParams drops claim and invite tokens", () => {
  const params = stripOneShotAuthParams(new URLSearchParams(
    "claim=secret&invite=tok&player=00-123",
  ));
  assert.equal(params.get("claim"), null);
  assert.equal(params.get("invite"), null);
  assert.equal(params.get("player"), "00-123");
});

test("stripProjectionParams tolerates empty input", () => {
  assert.equal(stripProjectionParams(undefined).toString(), "");
  assert.equal(stripProjectionParams(new URLSearchParams()).toString(), "");
});

test("tools mock-draft tab round-trips", () => {
  assert.deepEqual(parseAppPath("/tools/mock-draft").view, "tools");
  assert.equal(parseAppPath("/tools/mock-draft").toolsTab, "mock-draft");
  assert.equal(parseAppPath("/tools/dfs").toolsTab, "dfs");
  assert.equal(parseAppPath("/tools/unknown").toolsTab, "dfs");
  assert.equal(parseAppPath("/tools/best-ball").toolsTab, "best-ball");
  assert.equal(
    buildAppPath({ view: "tools", toolsTab: "mock-draft" }),
    "/tools/mock-draft",
  );
  assert.equal(buildAppPath({ view: "tools", toolsTab: "dfs" }), "/tools/dfs");
  assert.equal(
    buildAppPath({ view: "tools", toolsTab: "best-ball" }),
    "/tools/best-ball",
  );
});

test("Game center routes round-trip and legacy live URL redirects there", () => {
  assert.equal(parseAppPath("/hub/game").hubSubView, "game");
  assert.equal(parseAppPath("/hub/game-center").hubSubView, "game");
  assert.equal(
    buildAppPath({ view: "hub", hubSubView: "game" }),
    "/hub/game",
  );
  const legacy = parseAppPath("/hub/live");
  assert.equal(legacy.hubSubView, "game");
  assert.equal(legacy.insightTab, null);
});

test("Insights overview is the default Insights route", () => {
  assert.equal(parseAppPath("/hub/insights/overview").insightTab, "overview");
  assert.equal(
    buildAppPath({ view: "hub", hubSubView: "insights", insightTab: "overview" }),
    "/hub/insights/overview",
  );
  assert.equal(parseAppPath("/hub/insights").insightTab, "overview");
  assert.equal(parseAppPath("/hub/insights/spend").insightTab, "cap");
  assert.equal(parseAppPath("/hub/insights/history").insightTab, "ownership");
});

test("Fantasy rules and roster management routes round-trip", () => {
  assert.equal(parseAppPath("/hub/rules").hubSubView, "rules");
  assert.equal(buildAppPath({ view: "hub", hubSubView: "rules" }), "/hub/rules");
  assert.equal(parseAppPath("/hub/office").officeTab, "current");
  assert.equal(parseAppPath("/hub/office/chat").officeTab, "current");
  assert.equal(
    buildAppPath({ view: "hub", hubSubView: "office", officeTab: "current" }),
    "/hub/office/current",
  );
});

test("Contract history deep-link keeps the player query", () => {
  const params = buildFilterSearchParams({ player: "sleeper-4034" });
  assert.equal(params.get("player"), "sleeper-4034");
  const parsed = parseFilterParams(params);
  assert.equal(parsed.player, "sleeper-4034");
  const cleared = buildFilterSearchParams({ player: "", preserveParams: params });
  assert.equal(cleared.get("player"), null);
});

test("strategy and free-agent hub tabs round-trip, with legacy players alias", () => {
  assert.equal(parseAppPath("/hub/strategy").hubSubView, "value");
  assert.equal(parseAppPath("/hub/players").hubSubView, "value");
  assert.equal(buildAppPath({ view: "hub", hubSubView: "value" }), "/hub/strategy");
  assert.equal(parseAppPath("/hub/free-agents").hubSubView, "available");
  assert.equal(parseAppPath("/hub/fa").hubSubView, "available");
  assert.equal(parseAppPath("/hub/available").hubSubView, "available");
  assert.equal(buildAppPath({ view: "hub", hubSubView: "available" }), "/hub/free-agents");
});
