import test from "node:test";
import assert from "node:assert/strict";
import { buildCompanionArt } from "./companionArt.js";
import { releaseState, stepToy, toyBounds } from "./companionPhysics.js";

for (const theme of ["cozy", "snow", "leaves", "footballs"]) {
  test(theme + " props settle within their square after release from each corner", () => {
    for (const toy of buildCompanionArt(theme).toys) {
      const bounds = toyBounds(toy);
      assert.equal(bounds.right - bounds.left, 100);
      assert.equal(bounds.bottom - bounds.top, 100);
      for (const x of [bounds.left, bounds.right]) for (const y of [bounds.top, bounds.bottom]) {
        let motion = releaseState(toy, { x, y }, { x: 350, y: -350 });
        for (let i = 0; i < 600 && !motion.settled; i++) {
          motion = stepToy(toy, motion, 1 / 60);
          assert.ok(motion.x >= bounds.left && motion.x <= bounds.right);
          assert.ok(motion.y >= bounds.top && motion.y <= bounds.bottom);
          assert.ok(Number.isFinite(motion.rotation));
        }
        assert.equal(motion.settled, true);
        assert.equal(motion.vx, 0);
        assert.equal(motion.vy, 0);
        if (toy.anchor) assert.equal(motion.x, toy.anchor.x);
        else assert.equal(motion.y, bounds.bottom);
      }
    }
  });
}

test("loose snowball falls, bounces, then loses horizontal speed", () => {
  const toy = buildCompanionArt("snow").toys[0];
  const first = stepToy(toy, releaseState(toy, { x: toy.x, y: toy.y - 60 }, { x: 120 }), 1 / 60);
  assert.ok(first.y > toy.y - 60);
  assert.ok(first.vx < 120);
  const bounce = stepToy(toy, { ...first, y: toy.y - 1, vy: 150 }, 1 / 60);
  assert.equal(bounce.y, toy.y);
  assert.ok(bounce.vy < 0);
});

test("long suspended frames use a bounded physics step", () => {
  const toy = buildCompanionArt("cozy").toys[0];
  const motion = releaseState(toy, { x: toy.x + 40, y: toy.y - 40 });
  assert.deepEqual(stepToy(toy, motion, 100), stepToy(toy, motion, .025));
});
