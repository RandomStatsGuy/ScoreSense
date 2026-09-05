import assert from "node:assert/strict";
import test from "node:test";
import { columnAlign, livingSurfaceRoutes } from "./layout_audit.mjs";

test("numeric columns right-align", () => {
  assert.equal(columnAlign(["$12", "$8", "—", "$0"]), "right");
  assert.equal(columnAlign(["14.2", "9.1", "0.4"]), "right");
  assert.equal(columnAlign(["+3", "−1", "0"]), "right");
});

test("text columns left-align", () => {
  assert.equal(columnAlign(["Ja'Marr Chase", "Bijan Robinson"]), "left");
});

test("single-glyph columns center", () => {
  assert.equal(columnAlign(["QB", "RB", "WR"]), "center");
  assert.equal(columnAlign(["Q", "D", "P"]), "center");
});

test("livingSurfaceRoutes skips overlays and dedupes", () => {
  const surfaces = {
    "hub.roster": { label: "My team", route: "/hub/roster" },
    "hub.office": { label: "Roster management", route: "/hub/roster-management/contracts" },
    "hub.office.current": { label: "Contracts", route: "/hub/roster-management/contracts" },
    "hub.room.live": { label: "Draft (live)", route: "/hub/draft", overlay: true },
    "projections.inspector": { label: "Player inspector", overlay: true },
  };
  const rows = livingSurfaceRoutes(surfaces);
  assert.deepEqual(
    rows.map((r) => r.route),
    ["/hub/roster", "/hub/roster-management/contracts"],
  );
});
