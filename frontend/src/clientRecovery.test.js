import test from "node:test";
import assert from "node:assert/strict";
import { clientRecoveryUrl, recoverClientPage } from "./clientRecovery.js";

test("recovery bypasses the old worker and keeps destination, query and fragment", () => {
  const location = { pathname: "/hub/roster", search: "?team=mine&week=4", hash: "#lineup" };
  const url = new URL(clientRecoveryUrl(location), "https://app.fourthdownlabs.com");
  assert.equal(url.pathname, "/api/client-recovery");
  assert.equal(url.searchParams.get("return_to"), "/hub/roster?team=mine&week=4#lineup");
  assert.equal(clientRecoveryUrl({ pathname: "/hub/home" }), "/api/client-recovery?return_to=%2Fhub%2Fhome");
});

test("explicit recovery replaces the failed document instead of repeating reload", async () => {
  let destination;
  await recoverClientPage({ pathname: "/hub/home", replace: url => { destination = url; } });
  assert.equal(destination, "/api/client-recovery?return_to=%2Fhub%2Fhome");
});

async function withBrowser(run, { offline = false, status = 200, workerUrl = "/sw.js", workerError = false, cacheError = false } = {}) {
  const originals = Object.fromEntries(["navigator", "caches", "fetch"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const origin = "https://app.fourthdownlabs.com";
  const scope = origin + "/";
  const events = [];
  const location = { href: origin + "/hub/roster?week=4#lineup", pathname: "/hub/roster", search: "?week=4", hash: "#lineup",
    replace: url => events.push(["navigate", url]) };
  const names = ["scoresense-section-assets", "workbox-precache-v2-" + scope, "league-drafts",
    "workbox-precache-v2-" + origin + "/another-app/", "other-asset-cache"];
  const mocks = {
    navigator: { serviceWorker: { getRegistration: async url => {
      assert.equal(url, scope);
      return { scope, active: { scriptURL: new URL(workerUrl, origin).href }, unregister: async () => {
        events.push(["unregister"]);
        if (workerError) throw new Error("Worker storage unavailable");
      } };
    } } },
    caches: { keys: async () => { if (cacheError) throw new Error("CacheStorage unavailable"); return names; },
      delete: async name => { events.push(["delete", name]); return true; } },
    fetch: async (url, options) => {
      assert.match(url, /^\/api\/client-recovery\?/);
      assert.equal(options.cache, "no-store");
      assert.ok(options.signal instanceof AbortSignal);
      events.push(["fetch", url]);
      if (offline) throw new Error("offline");
      return new Response("<html>current shell</html>", { status });
    },
  };
  for (const [key, value] of Object.entries(mocks)) Object.defineProperty(globalThis, key, { configurable: true, value });
  try { await run({ location, events, scope }); }
  finally {
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  }
}

test("recovery retires only ScoreSense's worker and app-file caches before navigating", async () => {
  await withBrowser(async ({ location, events, scope }) => {
    await recoverClientPage(location);
    assert.deepEqual(events.map(event => event[0]), ["fetch", "unregister", "delete", "delete", "navigate"]);
    assert.deepEqual(events.filter(event => event[0] === "delete").map(event => event[1]),
      ["scoresense-section-assets", "workbox-precache-v2-" + scope]);
    const url = new URL(events.at(-1)[1], location.href);
    assert.equal(url.searchParams.get("return_to"), "/hub/roster?week=4#lineup");
  });
});

test("Fantasy home recovery refreshes assets before changing destination", async () => {
  await withBrowser(async ({ location, events }) => {
    await recoverClientPage(location, { pathname: "/hub/home" });
    assert.equal(events.at(-1)[1], "/api/client-recovery?return_to=%2Fhub%2Fhome");
    assert.ok(events.some(event => event[0] === "delete"));
  });
});

test("failed network checks keep the offline app files", async () => {
  for (const options of [{ offline: true }, { status: 503 }]) {
    await withBrowser(async ({ location, events }) => {
      await recoverClientPage(location);
      assert.deepEqual(events.map(event => event[0]), ["fetch", "navigate"]);
    }, options);
  }
});

test("recovery leaves unrelated service workers registered", async () => {
  await withBrowser(async ({ location, events }) => {
    await recoverClientPage(location);
    assert.equal(events.some(event => event[0] === "unregister"), false);
    assert.equal(events.filter(event => event[0] === "delete").length, 2);
  }, { workerUrl: "/other-worker.js" });
});

test("worker or cache storage failures still reach the network recovery shell", async () => {
  for (const options of [{ workerError: true }, { cacheError: true }]) {
    await withBrowser(async ({ location, events }) => {
      await recoverClientPage(location);
      assert.equal(events.at(-1)[0], "navigate");
    }, options);
  }
});

test("repeated recovery clicks share one cleanup and navigation", async () => {
  await withBrowser(async ({ location, events }) => {
    const first = recoverClientPage(location);
    const second = recoverClientPage(location);
    assert.equal(first, second);
    await first;
    assert.equal(events.filter(event => event[0] === "fetch").length, 1);
    assert.equal(events.filter(event => event[0] === "navigate").length, 1);
  });
});

test("automatic recovery cancelled during the shell check leaves the current page and caches intact", async () => {
  await withBrowser(async ({ location, events }) => {
    let allowed = true;
    let finishProbe;
    globalThis.fetch = () => new Promise(resolve => { finishProbe = resolve; });
    const pending = recoverClientPage(location, location, { shouldRecover: () => allowed });
    allowed = false;
    finishProbe(new Response("current shell"));
    assert.equal(await pending, false);
    assert.deepEqual(events, []);
  });
});

test("automatic recovery rechecks the active page after asynchronous cache cleanup", async () => {
  await withBrowser(async ({ location, events }) => {
    let allowed = true;
    const deleteCache = caches.delete;
    caches.delete = async name => { await deleteCache(name); allowed = false; };
    assert.equal(await recoverClientPage(location, location, { shouldRecover: () => allowed }), false);
    assert.equal(events.some(event => event[0] === "navigate"), false);
  });
});
