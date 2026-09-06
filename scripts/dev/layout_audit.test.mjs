import assert from "node:assert/strict";
import test from "node:test";
import {
  auditFailed,
  columnAlign,
  isAutoFillGridTemplate,
  isBlockDisplay,
  isGatedFailure,
  isInFlowPosition,
  isNumericCellText,
  isVisibleNativeSelect,
  livingSurfaceRoutes,
  minTargetForWidth,
  parseArgs,
  parseGate,
  pickBarControl,
  tableWidthDeadZone,
  remainderColumnIndex,
  columnIsOverwide,
  isCssGridTableRowGroup,
  elementClassName,
  COLUMN_PACK_RATIO,
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

test("remainder column is the first left-aligned text column", () => {
  assert.equal(remainderColumnIndex(["left", "center", "right"]), 0);
  assert.equal(remainderColumnIndex(["center", "left", "right"]), 1);
  assert.equal(remainderColumnIndex(["center", "right"]), -1);
});

test("non-remainder columns fail when wider than 1.5× content", () => {
  assert.equal(columnIsOverwide(96, 20, false), true);
  assert.equal(columnIsOverwide(24, 20, false), false);
  assert.equal(columnIsOverwide(400, 20, true), false);
  assert.equal(COLUMN_PACK_RATIO, 1.5);
});

test("elementClassName reads HTML strings and SVGAnimatedString", () => {
  assert.equal(elementClassName({ getAttribute: () => "hub-table-card", className: {} }), "hub-table-card");
  assert.equal(elementClassName({ className: { baseVal: "svg-grid" } }), "svg-grid");
  assert.equal(elementClassName({ className: "plain-grid" }), "plain-grid");
  assert.equal(elementClassName(null), "");
});

test("css-grid table groups need matching 3+ columns and no auto-fill", () => {
  assert.equal(isCssGridTableRowGroup([4, 4, 4], [false, false, false]), true);
  assert.equal(isCssGridTableRowGroup([2, 2], [false, false]), false);
  assert.equal(isCssGridTableRowGroup([4, 4], [true, false]), false);
  assert.equal(isCssGridTableRowGroup([4, 3], [false, false]), false);
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

test("bar height prefers a composite trigger over a nested input", () => {
  const trigger = { matches: (sel) => sel.includes("hub-filter-menu-trigger"), offsetHeight: 32 };
  const input = { matches: (sel) => sel.includes("input"), offsetHeight: 17 };
  const field = {
    matches: () => false,
    querySelector: (sel) => (sel.includes("hub-filter-menu-trigger") ? trigger : input),
  };
  assert.equal(pickBarControl(field), trigger);
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
  assert.equal(isInFlowPosition("relative"), true);
  assert.equal(isInFlowPosition("static"), true);
  assert.equal(isInFlowPosition("fixed"), false);
  assert.equal(isInFlowPosition("absolute"), false);
  assert.equal(isInFlowPosition("sticky"), false);
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

test("gate list parses and ignores backlog rules", () => {
  assert.deepEqual(parseGate("type,selects,collisions,grids"), ["type", "selects", "collisions", "grids"]);
  assert.equal(parseGate(""), null);
  const args = parseArgs(["--all", "--width", "1280", "--gate", "type,selects"]);
  assert.deepEqual(args.gate, ["type", "selects"]);
  assert.equal(isGatedFailure({ rule: "primaries", ok: false }, args.gate), false);
  assert.equal(isGatedFailure({ rule: "type", ok: false }, args.gate), true);
  assert.equal(isGatedFailure({ rule: "load", ok: false }, args.gate), true);
  const report = [
    {
      route: "/hub/home",
      results: [
        { rule: "type", ok: true },
        { rule: "primaries", ok: false },
      ],
    },
  ];
  assert.equal(auditFailed(report, args.gate), false);
  assert.equal(auditFailed(report, null), true);
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
