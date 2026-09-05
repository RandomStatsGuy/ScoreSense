import assert from "node:assert/strict";
import test from "node:test";

import {
  ensureHubMediaObjectUrl,
  hubMediaInflightCount,
  resetHubMediaUrlCacheForTests,
} from "./hubMediaUrl.js";

const mem = {};
globalThis.localStorage = {
  getItem: (k) => (Object.hasOwn(mem, k) ? mem[k] : null),
  setItem: (k, v) => {
    mem[k] = String(v);
  },
  removeItem: (k) => {
    delete mem[k];
  },
};

test("hub media blob fetch coalesces concurrent callers", async () => {
  resetHubMediaUrlCacheForTests();
  let calls = 0;
  const orig = globalThis.fetch;
  const origCreate = globalThis.URL?.createObjectURL;
  globalThis.URL = globalThis.URL || class URL {};
  globalThis.URL.createObjectURL = () => "blob:hub-media";
  globalThis.fetch = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 15));
    return {
      ok: true,
      blob: async () => new Blob(["x"], { type: "image/webp" }),
    };
  };
  try {
    const [a, b] = await Promise.all([
      ensureHubMediaObjectUrl("/api/hub/media/logo?w=96"),
      ensureHubMediaObjectUrl("/api/hub/media/logo?w=96"),
    ]);
    assert.equal(calls, 1);
    assert.equal(a, b);
    assert.equal(hubMediaInflightCount(), 0);
  } finally {
    globalThis.fetch = orig;
    if (origCreate) globalThis.URL.createObjectURL = origCreate;
  }
});
