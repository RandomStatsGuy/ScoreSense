import assert from "node:assert/strict";
import test from "node:test";
import { menuPlacement } from "./menuPlacement.js";

const trigger = (top, height = 40) => ({ top, bottom: top + height });

test("opens below when the list fits", () => {
  assert.deepEqual(
    menuPlacement({ trigger: trigger(100), panelHeight: 200, viewportHeight: 844 }),
    { side: "below", maxHeight: 692 },
  );
});

test("flips above when the bottom nav leaves no room below", () => {
  const nav = { top: 774, bottom: 844 };
  const placed = menuPlacement({ trigger: trigger(700), panelHeight: 180, viewportHeight: 844, obstacles: [nav] });
  assert.equal(placed.side, "above");
  assert.equal(placed.maxHeight, 688);
});

test("stays below and caps height when below still has more room", () => {
  const placed = menuPlacement({ trigger: trigger(300), panelHeight: 600, viewportHeight: 844 });
  assert.deepEqual(placed, { side: "below", maxHeight: 492 });
});

test("caps the list above the chat launcher it would run into", () => {
  const launcher = { top: 700, bottom: 756 };
  const placed = menuPlacement({ trigger: trigger(560), panelHeight: 150, viewportHeight: 844, obstacles: [launcher] });
  assert.equal(placed.side, "above");
});

test("obstacles above the trigger lower the ceiling for an upward menu", () => {
  const header = { top: 0, bottom: 120 };
  const nav = { top: 774, bottom: 844 };
  const placed = menuPlacement({ trigger: trigger(600), panelHeight: 400, viewportHeight: 844, obstacles: [header, nav] });
  assert.deepEqual(placed, { side: "above", maxHeight: 468 });
});
