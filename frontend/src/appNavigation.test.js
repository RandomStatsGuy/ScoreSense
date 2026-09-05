import assert from "node:assert/strict";
import test from "node:test";
import { APP_SECTIONS } from "./appNavigation.js";

test("bottom nav uses the full Projections word", () => {
  const projections = APP_SECTIONS.find((item) => item.id === "projections");
  assert.equal(projections.label, "Projections");
  assert.equal(projections.shortLabel, "Projections");
  assert.deepEqual(
    APP_SECTIONS.map((item) => item.shortLabel),
    ["Projections", "Fantasy", "Tools"],
  );
});
