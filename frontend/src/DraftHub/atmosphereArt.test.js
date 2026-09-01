/**
 * Run with: node --test frontend/src/DraftHub/atmosphereArt.test.js
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  ATMOSPHERE_DENSITY,
  ATMOSPHERE_LAYERS,
  FUR_COLORS,
  LEAF_COLORS,
  LEAF_VARIANTS,
  YARN_COLORS,
  buildAtmosphereParticles,
  buildPileClusters,
  intensityPreset,
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

test("cozy mixes dust motes, fur tufts, and yarn with the right palettes", () => {
  const cozy = buildAtmosphereParticles("cozy", { density: 40, rng: seededRng(3) });
  const variants = new Set(cozy.map((p) => p.variant));
  assert.ok(variants.has(0) && variants.has(1) && variants.has(2), "all three cozy kinds spawn");
  for (const p of cozy) {
    if (p.variant === 1) {
      assert.ok(FUR_COLORS.some(([a, b]) => a === p.colors[0] && b === p.colors[1]));
      assert.equal(p.spinMode, "rock", "fur drifts with a lazy rock");
    }
    if (p.variant === 2) {
      assert.ok(YARN_COLORS.some(([a, b]) => a === p.colors[0] && b === p.colors[1]));
      assert.equal(p.spinMode, "spin", "yarn rolls end-over-end");
    }
    if (p.layer === "far") assert.equal(p.variant, 0, "far layer is dust motes only");
  }
});

test("intensity presets scale density and opacity", () => {
  assert.equal(intensityPreset("standard").density, ATMOSPHERE_DENSITY);
  assert.ok(intensityPreset("subtle").density < intensityPreset("lively").density);
  assert.ok(intensityPreset("subtle").opacity < intensityPreset("lively").opacity);
  assert.deepEqual(intensityPreset("nonsense"), intensityPreset("standard"));
});

test("pile clusters span the bottom edge with bounded transforms", () => {
  const clusters = buildPileClusters("leaves", { rng: seededRng(5) });
  assert.ok(clusters.length >= 6);
  for (const cluster of clusters) {
    assert.ok(cluster.left >= -10 && cluster.left <= 110);
    assert.ok(cluster.scale >= 0.6 && cluster.scale <= 1.3);
    assert.ok(cluster.growDelay >= 0 && cluster.growDelay <= 8);
    assert.ok(LEAF_COLORS.some(([a]) => a === cluster.colors[0]));
  }
  // Footballs pile in fewer, chunkier clusters; unknown themes pile nothing.
  assert.ok(buildPileClusters("footballs", { rng: seededRng(5) }).length <= 6);
  assert.deepEqual(buildPileClusters("none"), []);
  assert.deepEqual(buildPileClusters("casino"), []);
  const cozyPile = buildPileClusters("cozy", { rng: seededRng(5) });
  assert.ok(cozyPile.length >= 6);
  for (const cluster of cozyPile) {
    assert.ok(FUR_COLORS.some(([a]) => a === cluster.colors[0]));
  }
});
