import test from "node:test";
import assert from "node:assert/strict";
import { apiFetch, clearGuestSession, setGuestSession, setToken } from "./auth.js";

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

test("apiFetch does not force JSON content-type for FormData uploads", async () => {
  setToken("tok");
  let init;
  const orig = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    init = options;
    return new Response("{}", { status: 200 });
  };
  try {
    const fd = new FormData();
    fd.append("file", new Blob(["hi"], { type: "text/plain" }), "cap.tsv");
    await apiFetch("/api/hub/cap-sheet/validate?replace_existing=true", {
      method: "POST",
      body: fd,
    });
    assert.equal(init.headers["Content-Type"], undefined);
    assert.equal(init.headers["content-type"], undefined);
    assert.equal(init.headers.Authorization, "Bearer tok");
    assert.ok(init.body instanceof FormData);
  } finally {
    globalThis.fetch = orig;
  }
});

test("apiFetch uses a guest token only on hub URLs", async () => {
  setToken(null);
  setGuestSession({ token: "guest-tok", leagueId: "lg-1", roomCode: "ABC123" });
  let hubInit;
  let meInit;
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (String(url).includes("/api/hub")) hubInit = options;
    else meInit = options;
    return new Response("{}", { status: 200 });
  };
  try {
    await apiFetch("/api/hub/league/lg-1");
    await apiFetch("/api/auth/me");
    assert.equal(hubInit.headers.Authorization, "Bearer guest-tok");
    assert.equal(meInit.headers.Authorization, undefined);
  } finally {
    globalThis.fetch = orig;
    clearGuestSession();
  }
});

test("apiFetch sets JSON content-type for JSON bodies", async () => {
  setToken("tok");
  let init;
  const orig = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    init = options;
    return new Response("{}", { status: 200 });
  };
  try {
    await apiFetch("/api/hub/x", { method: "POST", body: JSON.stringify({ a: 1 }) });
    assert.equal(init.headers["Content-Type"], "application/json");
    assert.equal(init.headers.Authorization, "Bearer tok");
  } finally {
    globalThis.fetch = orig;
  }
});
