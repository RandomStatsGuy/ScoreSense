import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import {
  auditFailed,
  columnAlign,
  isAutoFillGridTemplate,
  isBlockDisplay,
  isGatedFailure,
  isInFlowPosition,
  isNumericCellText,
  isVisibleNativeSelect,
  laterSiblingCoversMenuHost,
  livingSurfaceRoutes,
  minTargetForWidth,
  measureScript,
  parseArgs,
  parseGate,
  pickBarControl,
  tableWidthDeadZone,
  remainderColumnIndex,
  columnIsOverwide,
  isCssGridTableRowGroup,
  elementClassName,
  COLUMN_PACK_RATIO,
  BAR_CONTROL_SELECTOR,
  NUMERIC_RE,
} from "./layout_audit.mjs";

test("numeric columns right-align", () => {
  assert.equal(columnAlign(["$12", "$8", "—", "$0"]), "right");
  assert.equal(columnAlign(["14.2", "9.1", "0.4"]), "right");
  assert.equal(columnAlign(["+3", "−1", "0"]), "right");
  assert.equal(columnAlign(["1st", "2nd", "10th"]), "right");
  assert.equal(columnAlign(["15pts", "9pts", "120yds"]), "right");
});

test("signed currency stays numeric", () => {
  assert.equal(columnAlign(["-$300.00", "+$80.00", "$0.00"]), "right");
  assert.equal(isNumericCellText("-$300.00"), true);
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

// Run the actual self-contained browser measurement with controlled DOMRects;
// unrelated surface queries are empty, so no browser or running app is needed.
function measureControlRow(rects, width = 1280, disclosure = null) {
  const rect = (left, top, boxWidth, height) => ({ left, top, width: boxWidth, height, right: left + boxWidth, bottom: top + height });
  const control = (kind, box) => ({
    getBoundingClientRect: () => box,
    matches: (selector) => selector === BAR_CONTROL_SELECTOR || (kind === "menu" && selector.includes("hub-filter-menu-trigger")),
    querySelector: () => null,
  });
  const children = rects.map((box, i) => {
    const field = control(i === 1 ? "menu" : "input", box);
    if (i === 2) return field; // The action is a direct child of the row.
    const nestedInput = control("input", rect(box.left, box.top + 10, box.width, 17));
    return {
      matches: () => false,
      // Label wrappers intentionally differ; only the actual controls matter.
      getBoundingClientRect: () => rect(box.left, box.top - 20 * (i + 1), box.width, box.height + 20 * (i + 1)),
      querySelector: (selector) => selector.includes("hub-filter-menu-trigger") ? (i === 1 ? field : null) : (i === 1 ? nestedInput : field),
    };
  });
  const row = { children, getBoundingClientRect: () => rect(0, 0, width, 400), getAttribute: () => "setup-controls" };
  if (disclosure) {
    const summary = { tagName: "SUMMARY", contains: element => disclosure.inSummary && element === row };
    row.parentElement = { tagName: "DETAILS", open: disclosure.open, children: [summary] };
  }
  const document = {
    documentElement: { scrollWidth: width }, body: { scrollWidth: width }, styleSheets: [],
    querySelector: () => null,
    querySelectorAll: (selector) => selector === "[data-control-row]" ? [row] : [],
  };
  const result = runInNewContext(`(${measureScript().toString()})(args)`, {
    document, innerWidth: width, window: { innerWidth: width, innerHeight: 900 },
    getComputedStyle: () => ({ visibility: "visible", fontSize: "16px", getPropertyValue: () => "12px" }),
    args: { minTarget: minTargetForWidth(width), numericRe: NUMERIC_RE.source, barControlSelector: BAR_CONTROL_SELECTOR },
  });
  return result.filter(item => item.rule === "control-rows");
}

const controlBox = (left, top, width = 120, height = 44) => ({ left, top, width, height, right: left + width, bottom: top + height });

test("marked control rows measure actual fields, composite triggers and actions", () => {
  const [result] = measureControlRow([controlBox(20, 56), controlBox(160, 56, 240), controlBox(420, 56)]);
  assert.equal(result.ok, true);
  assert.equal(result.selector, "setup-controls");
});

test("marked control rows reject side-by-side controls with different bottom edges", () => {
  const [result] = measureControlRow([controlBox(20, 56), controlBox(160, 32, 240), controlBox(420, 56)]);
  assert.equal(result.ok, false);
  assert.match(result.detail, /side-by-side bottom edges/);
  assert.doesNotMatch(result.detail, /control heights/);
});

test("marked control rows reject unequal heights even with aligned bottom edges", () => {
  const [result] = measureControlRow([controlBox(20, 56), controlBox(160, 64, 240, 36), controlBox(420, 56)]);
  assert.equal(result.ok, false);
  assert.match(result.detail, /control heights 44.0, 36.0, 44.0px/);
  assert.doesNotMatch(result.detail, /side-by-side bottom edges/);
});

test("marked control rows catch an action far below a neighboring column", () => {
  const [result] = measureControlRow([controlBox(20, 56), controlBox(160, 56, 240), controlBox(420, 190)]);
  assert.equal(result.ok, false);
  assert.match(result.detail, /side-by-side bottom edges/);
});
test("marked control rows allow a real grid wrap without weakening misplaced-action checks", () => {
  const [result] = measureControlRow([controlBox(20, 56), controlBox(160, 56, 240), controlBox(20, 130)]);
  assert.equal(result.ok, true);
});
test("closed disclosure fields with retained rectangles are excluded from measurement", () => {
  const rects = [controlBox(20, 56), controlBox(160, 32, 240), controlBox(420, 56)];
  assert.equal(measureControlRow(rects, 1280, { open: false }).length, 0);
  assert.equal(measureControlRow(rects, 1280, { open: true })[0].ok, false);
  assert.equal(measureControlRow(rects, 1280, { open: false, inSummary: true })[0].ok, false);
});

test("marked control rows allow vertically stacked phone controls", () => {
  const [result] = measureControlRow([controlBox(20, 40, 350), controlBox(20, 110, 350), controlBox(20, 180, 350)], 390);
  assert.equal(result.ok, true);
});

test("marked phone control rows still reject a mismatched control height", () => {
  const [result] = measureControlRow([controlBox(20, 40, 350), controlBox(20, 110, 350, 36), controlBox(20, 180, 350)], 390);
  assert.equal(result.ok, false);
  assert.match(result.detail, /control heights/);
  assert.doesNotMatch(result.detail, /side-by-side bottom edges/);
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

test("later sibling at the same z-index covers an overflowing menu host", () => {
  assert.equal(laterSiblingCoversMenuHost("1", "1"), true);
  assert.equal(laterSiblingCoversMenuHost("auto", "1"), true);
  assert.equal(laterSiblingCoversMenuHost("60", "1"), false);
  assert.equal(laterSiblingCoversMenuHost("20", "auto"), false);
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
