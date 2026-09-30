import assert from "node:assert/strict";
import test from "node:test";
import { preloadFantasyPage } from "./fantasyPageModules.js";

test("code warmup loads only the selected page and handles legacy week URLs", async () => {
  const calls = [];
  const modules = { week: () => calls.push("week"), roster: () => calls.push("roster") };
  await preloadFantasyPage("game", modules);
  await preloadFantasyPage("unknown", modules);
  assert.deepEqual(calls, ["week"]);
});

test("failed or pending code warmup does not block workspace loading", async () => {
  let resolve;
  const pending = new Promise(r => { resolve = r; });
  const warmup = preloadFantasyPage("week", { week: () => pending });
  assert.equal(await Promise.resolve("workspace"), "workspace");
  resolve();
  await warmup;
  await preloadFantasyPage("week", { week: () => { throw new Error("offline"); } });
});
