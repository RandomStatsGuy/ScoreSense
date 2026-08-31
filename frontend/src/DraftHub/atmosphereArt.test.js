/**
 * Run with: node --test frontend/src/DraftHub/atmosphereArt.test.js
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  ATMOSPHERE_DENSITY,
  ATMOSPHERE_LAYERS,
  LEAF_COLORS,
  LEAF_VARIANTS,
  buildAtmosphereParticles,
} from "./atmosphereArt.js";

/** Deterministic LCG so particle output is reproducible in tests. */
function seededRng(seed = 42) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

test("layer shares cover the whole density budget", () => {
  const total = ATMOSPHERE_LAYERS.reduce((sum, layer) => sum + layer.share, 0);
  assert.ok(Math.abs(total - 1) < 1e-9);
});

test("returns nothing for off/unknown themes", () => {
  assert.deepEqual(buildAtmosphereParticles("none"), []);
  assert.deepEqual(buildAtmosphereParticles(""), []);
  assert.deepEqual(buildAtmosphereParticles("confetti"), []);
  assert.deepEqual(buildAtmosphereParticles(undefined), []);
});

test("builds every layer with unique ids and pre-scattered fall delays", () => {
  const particles = buildAtmosphereParticles("leaves", { rng: seededRng() });
  assert.ok(particles.length >= ATMOSPHERE_DENSITY - 2);
  const ids = new Set(particles.map((p) => p.id));
  assert.equal(ids.size, particles.length);
  const layers = new Set(particles.map((p) => p.layer));
  assert.deepEqual([...layers].sort(), ["far", "mid", "near"]);
  for (const p of particles) {
    assert.ok(p.fallDelay <= 0, "negative delay scatters particles on first paint");
    assert.ok(p.fallDuration > 0);
    assert.ok(p.swayAmp >= 8);
    assert.equal(p.interactive, p.layer !== "far");
  }
});

test("density scales the particle count", () => {
  const light = buildAtmosphereParticles("snow", { density: 12, rng: seededRng() });
  const heavy = buildAtmosphereParticles("snow", { density: 48, rng: seededRng() });
  assert.ok(heavy.length > light.length);
});

test("leaves carry palette + silhouette variants; snow mixes dots and crystals", () => {
  const leaves = buildAtmosphereParticles("leaves", { rng: seededRng(7) });
  for (const leaf of leaves) {
    assert.ok(LEAF_COLORS.some(([a, b]) => a === leaf.colors[0] && b === leaf.colors[1]));
    assert.ok(leaf.variant === 0 || leaf.variant === 1);
    assert.ok(LEAF_VARIANTS[leaf.variant]);
  }
  const snow = buildAtmosphereParticles("snow", { rng: seededRng(7) });
  const snowVariants = new Set(snow.map((p) => p.variant));
  assert.ok(snowVariants.has(0) && snowVariants.has(1), "both soft dots and crystals spawn");
});

test("footballs mix end-over-end spins with rocking, and render larger", () => {
  const rng = seededRng(11);
  const footballs = buildAtmosphereParticles("footballs", { rng });
  const modes = new Set(footballs.map((p) => p.spinMode));
  assert.ok(modes.has("spin") && modes.has("rock"));
  const snow = buildAtmosphereParticles("snow", { rng: seededRng(11) });
  const avg = (list) => list.reduce((sum, p) => sum + p.size, 0) / list.length;
  assert.ok(avg(footballs) > avg(snow), "football size multiplier applies");
});
