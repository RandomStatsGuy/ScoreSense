import assert from "node:assert/strict";
import test from "node:test";
import {
  columnAlign,
  isAutoFillGridTemplate,
  isBlockDisplay,
  isNumericCellText,
  isVisibleNativeSelect,
  livingSurfaceRoutes,
  minTargetForWidth,
  pickBarControl,
  tableWidthDeadZone,
} from "./layout_audit.mjs";

test("numeric columns right-align", () => {
  assert.equal(columnAlign(["$12", "$8", "—", "$0"]), "right");
  assert.equal(columnAlign(["14.2", "9.1", "0.4"]), "right");
  assert.equal(columnAlign(["+3", "−1", "0"]), "right");
  assert.equal(columnAlign(["1st", "2nd", "10th"]), "right");
  assert.equal(columnAlign(["15pts", "9pts", "120yds"]), "right");
});

test("numeric cell text accepts ordinals and units", () => {
  assert.equal(isNumericCellText("1st"), true);
  assert.equal(isNumericCellText("15pts"), true);
  assert.equal(isNumericCellText("120yds"), true);
  assert.equal(isNumericCellText("Ja'Marr Chase"), false);
});

test("table dead zone subtracts card padding", () => {
  assert.equal(tableWidthDeadZone(300, 360, 16, 16), 28);
  assert.ok(tableWidthDeadZone(300, 360, 16, 16) < 32);
  assert.ok(tableWidthDeadZone(200, 360, 16, 16) > 32);
});

test("visible native select ignores hidden boxes", () => {
  assert.equal(isVisibleNativeSelect({ width: 120, height: 32, display: "block", visibility: "visible" }), true);
  assert.equal(isVisibleNativeSelect({ width: 120, height: 32, display: "none", visibility: "visible" }), false);
  assert.equal(isVisibleNativeSelect({ width: 0, height: 0, display: "block", visibility: "visible" }), false);
});

test("bar height check uses the interactive control", () => {
  const button = { matches: (sel) => sel.includes("button"), offsetHeight: 32 };
  const label = { matches: () => false, querySelector: () => null, offsetHeight: 18 };
  const wrapped = { matches: () => false, querySelector: () => button };
  assert.equal(pickBarControl(button), button);
  assert.equal(pickBarControl(label), null);
  assert.equal(pickBarControl(wrapped), button);
});

test("text columns left-align", () => {
  assert.equal(columnAlign(["Ja'Marr Chase", "Bijan Robinson"]), "left");
});

test("single-glyph columns center", () => {
  assert.equal(columnAlign(["QB", "RB", "WR"]), "center");
  assert.equal(columnAlign(["Q", "D", "P"]), "center");
});

test("collisions only treat block-level display as siblings", () => {
  assert.equal(isBlockDisplay("block"), true);
  assert.equal(isBlockDisplay("flex"), true);
  assert.equal(isBlockDisplay("grid"), true);
  assert.equal(isBlockDisplay("inline"), false);
  assert.equal(isBlockDisplay("inline-block"), false);
  assert.equal(isBlockDisplay("inline-flex"), false);
});

test("grids only match auto-fill or auto-fit templates", () => {
  assert.equal(isAutoFillGridTemplate("repeat(auto-fill, minmax(12rem, 1fr))"), true);
  assert.equal(isAutoFillGridTemplate("repeat(auto-fit, minmax(16rem, 1fr))"), true);
  assert.equal(isAutoFillGridTemplate("minmax(0, 1fr) 20rem"), false);
  assert.equal(isAutoFillGridTemplate("1fr 1fr"), false);
});

test("target floor is 32 at desktop and 44 at 390", () => {
  assert.equal(minTargetForWidth(1280), 32);
  assert.equal(minTargetForWidth(390), 44);
  assert.equal(minTargetForWidth(1024), 32);
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
