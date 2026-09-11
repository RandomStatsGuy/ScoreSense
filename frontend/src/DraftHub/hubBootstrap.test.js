import test from "node:test";
import assert from "node:assert/strict";
import { loadHubBootstrap } from "./hubBootstrap.js";

const flush = () => new Promise((resolve) => setImmediate(resolve));

test("workspace resolves while presets are still pending, then presets update", async () => {
  let finishPresets;
  let applied;
  const task = loadHubBootstrap({
    loadWorkspace: async () => ({ league_id: "test-league" }),
    loadPresets: () => new Promise((resolve) => { finishPresets = resolve; }),
    onPresets: (value) => { applied = value; },
  });
  assert.deepEqual(await task, { league_id: "test-league" });
  assert.equal(applied, undefined);
  finishPresets(["template"]);
  await flush();
  assert.deepEqual(applied, ["template"]);
});

test("preset errors do not fail workspace or replace existing presets", async () => {
  let applied = false;
  const workspace = await loadHubBootstrap({
    loadWorkspace: async () => "workspace",
    loadPresets: async () => { throw new Error("presets unavailable"); },
    onPresets: () => { applied = true; },
  });
  await flush();
  assert.equal(workspace, "workspace");
  assert.equal(applied, false);
});

test("aborted requests cannot apply late presets", async () => {
  const controller = new AbortController();
  let finishPresets;
  let applied = false;
  await loadHubBootstrap({
    loadWorkspace: async () => "workspace",
    loadPresets: () => new Promise((resolve) => { finishPresets = resolve; }),
    onPresets: () => { applied = true; },
    signal: controller.signal,
  });
  controller.abort();
  finishPresets(["late"]);
  await flush();
  assert.equal(applied, false);
});

test("workspace errors still reject and demo works without presets", async () => {
  await assert.rejects(loadHubBootstrap({ loadWorkspace: async () => { throw new Error("workspace unavailable"); } }), /workspace unavailable/);
  assert.equal(await loadHubBootstrap({ loadWorkspace: async () => "demo", loadPresets: null }), "demo");
});
