import test from "node:test";
import assert from "node:assert/strict";
import { apiFetch, clearGuestSession, loginWithGoogle, setGuestSession, setToken } from "./auth.js";

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
  let leagueInit;
  let contextInit;
  let meInit;
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const href = String(url);
    if (href.includes("/league/")) leagueInit = options;
    else if (href.includes("/context")) contextInit = options;
    else meInit = options;
    return new Response("{}", { status: 200 });
  };
  try {
    await apiFetch("/api/hub/league/lg-1");
    await apiFetch("/api/hub/context");
    await apiFetch("/api/auth/me");
    assert.equal(leagueInit.headers.Authorization, "Bearer guest-tok");
    assert.equal(contextInit.headers.Authorization, undefined);
    assert.equal(meInit.headers.Authorization, undefined);
  } finally {
    globalThis.fetch = orig;
    clearGuestSession();
  }
});

test("guest token does not match a league id substring in the path", async () => {
  setToken(null);
  setGuestSession({ token: "guest-tok", leagueId: "lg-1", roomCode: "ABC123" });
  let init;
  const orig = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    init = options;
    return new Response("{}", { status: 200 });
  };
  try {
    await apiFetch("/api/hub/league/lg-12");
    assert.equal(init.headers.Authorization, undefined);
  } finally {
    globalThis.fetch = orig;
    clearGuestSession();
  }
});

test("loginWithGoogle reads the authorize URL and redirects", async () => {
  const origFetch = globalThis.fetch;
  const origWindow = globalThis.window;
  const loc = { pathname: "/login", search: "", href: "" };
  globalThis.window = { location: loc };
  globalThis.fetch = async (url) => {
    assert.match(String(url), /\/api\/auth\/google\/login\?next=/);
    return new Response(JSON.stringify({ url: "https://accounts.google.com/o/oauth2/v2/auth?x=1" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    await loginWithGoogle("/hub/home");
    assert.equal(loc.href, "https://accounts.google.com/o/oauth2/v2/auth?x=1");
  } finally {
    globalThis.fetch = origFetch;
    globalThis.window = origWindow;
  }
});

test("loginWithGoogle surfaces a 503 detail", async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ detail: "Google sign-in isn't set up on this server yet." }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  try {
    await assert.rejects(() => loginWithGoogle("/hub/home"), /Google sign-in isn't set up/);
  } finally {
    globalThis.fetch = origFetch;
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
