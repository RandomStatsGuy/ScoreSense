import test from "node:test";
import assert from "node:assert/strict";
import { bootstrapAuth } from "./authBootstrap.js";

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("starts identity before config resolves and waits for both", async () => {
  const config = deferred();
  const user = deferred();
  const calls = [];
  let ready = false;
  const boot = bootstrapAuth({
    fetchConfig: () => { calls.push("config"); return config.promise; },
    refreshUser: () => { calls.push("user"); return user.promise; },
    applyConfig: (value) => calls.push(value),
  }).then(() => { ready = true; });
  assert.deepEqual(calls, ["config", "user"]);
  config.resolve("applied");
  await Promise.resolve();
  assert.equal(ready, false);
  assert.deepEqual(calls, ["config", "user", "applied"]);
  user.resolve();
  await boot;
  assert.equal(ready, true);
});

test("identity failure still applies required-auth config before releasing the gate", async () => {
  const config = deferred();
  const failure = new Error("identity unavailable");
  let applied;
  let finished = false;
  const boot = bootstrapAuth({
    fetchConfig: () => config.promise,
    refreshUser: () => Promise.reject(failure),
    applyConfig: (value) => { applied = value; },
  });
  const checked = assert.rejects(boot, failure).then(() => { finished = true; });
  await Promise.resolve();
  assert.equal(finished, false);
  config.resolve({ auth_required: true });
  await checked;
  assert.deepEqual(applied, { auth_required: true });
});

test("config failure waits for the identity request to settle too", async () => {
  const user = deferred();
  const failure = new Error("config unavailable");
  let finished = false;
  const boot = bootstrapAuth({
    fetchConfig: () => Promise.reject(failure),
    refreshUser: () => user.promise,
    applyConfig: () => assert.fail("no config to apply"),
  });
  const checked = assert.rejects(boot, failure).then(() => { finished = true; });
  await Promise.resolve();
  assert.equal(finished, false);
  user.resolve();
  await checked;
});
