import assert from "node:assert/strict";
import test from "node:test";
import { AUTH_COPY, authModeHref, authOauthNext, authSessionContext, clearLandingAuthIntent, readLandingAuthIntent, rememberLandingAuthIntent, safeAuthNext } from "./authPresentation.js";

test("auth copy names the goal and skips banned verbs", () => {
  assert.match(AUTH_COPY.passwordDisabled, /Forgot password/);
  assert.doesNotMatch(AUTH_COPY.passwordDisabled, /Google/);
  assert.match(AUTH_COPY.login.heading, /league/i);
  assert.match(AUTH_COPY.register.heading, /login|league/i);
  assert.match(AUTH_COPY.google, /Google/);
  assert.doesNotMatch(AUTH_COPY.login.submit, /Submit|Draft Hub|permission/i);
  assert.doesNotMatch(AUTH_COPY.register.support, /Submit|Draft Hub|permission/i);
  assert.doesNotMatch(AUTH_COPY.forgot.sent, /Submit|Draft Hub/i);
});

test("safeAuthNext only keeps in-app return paths", () => {
  assert.equal(safeAuthNext("/hub/home"), "/hub/home");
  assert.equal(safeAuthNext("/projections/weekly?pos=rb"), "/projections/weekly?pos=rb");
  assert.equal(safeAuthNext("https://evil.example/phish"), "/projections/weekly");
  assert.equal(safeAuthNext("//evil.example"), "/projections/weekly");
  assert.equal(safeAuthNext("/login?next=/hub"), "/projections/weekly");
  assert.equal(safeAuthNext("/register"), "/projections/weekly");
  assert.equal(safeAuthNext("/auth/callback?token=x"), "/projections/weekly");
  assert.equal(safeAuthNext(""), "/projections/weekly");
});

test("authOauthNext prefers an explicit next, then the query string", () => {
  assert.equal(authOauthNext("/hub/draft"), "/hub/draft");
  assert.equal(authOauthNext("", "?next=/hub/home"), "/hub/home");
  assert.equal(authOauthNext("", "?next=https://evil"), "/projections/weekly");
});

test("auth destinations preserve the selected landing path through account mode switches and OAuth", () => {
  for (const [intent, path] of [["weekly", "/projections/weekly"], ["fantasy", "/hub/home"], ["tools", "/tools/mock-draft"]]) {
    const context = authSessionContext(`?from=landing&intent=${intent}&next=${encodeURIComponent(path)}`);
    assert.equal(context.next, path);
    assert.equal(context.backTo, { weekly: "/projections", fantasy: "/fantasy", tools: "/tools" }[intent]);
    const login = authModeHref("login", context.next, context);
    assert.equal(new URL(login, "https://scoresense.invalid").pathname, "/login");
    const switched = authSessionContext(login.split("?")[1]);
    assert.equal(switched.next, context.next);
    assert.equal(switched.intent, context.intent);
    assert.equal(switched.fromLanding, true);
    assert.equal(switched.backTo, context.backTo);
    assert.equal(authOauthNext(switched.next), path);
  }
});

test("direct invite and claim destinations keep their original tokens without gaining landing context", () => {
  for (const next of ["/hub/home?invite=fixture%2Btoken", "/hub/draft?claim=fixture%2Ftoken&league=fixture"]) {
    const context = authSessionContext(`?next=${encodeURIComponent(next)}`);
    assert.equal(context.next, next);
    assert.equal(context.backTo, next);
    assert.equal(context.fromLanding, false);
    const switched = new URL(authModeHref("register", next, context), "https://scoresense.invalid");
    assert.equal(switched.searchParams.get("next"), next);
    assert.equal(switched.searchParams.has("from"), false);
    assert.equal(authOauthNext(context.next), next);
  }
});

test("landing context validates intent and falls back to a useful safe destination", () => {
  assert.equal(authSessionContext("?from=landing&intent=tools").next, "/tools/mock-draft");
  const context = authSessionContext("?from=landing&intent=javascript:alert(1)&next=https://evil.example");
  assert.equal(context.next, "/projections/weekly");
  assert.equal(context.backTo, "/projections");
  assert.equal(context.intent, "weekly");
  assert.equal(authSessionContext("?next=/tools/dfs").intent, "tools");
  assert.equal(authSessionContext("?next=/hub/home").intent, "fantasy");
});

test("auth destination display follows the actual safe path while preserving intent artwork", () => {
  for (const [path, name] of [["/tools/dfs?slate=fixture", "DFS"], ["/tools/best-ball", "Best ball"], ["/tools/mock-draft", "Mock draft"], ["/tools/other", "Tools"], ["/projections/weekly", "Weekly projections"], ["/projections/season", "Season outlook"], ["/projections/season/preseason", "Preseason outlook"], ["/projections/season/live", "Live season"], ["/projections/other", "Projections"], ["/hub/home", "Fantasy"], ["/account", "ScoreSense"]]) {
    const context = authSessionContext(`?next=${encodeURIComponent(path)}&from=landing&intent=weekly`);
    assert.equal(context.destination.name, name, path);
    assert.equal(context.next, path);
    assert.equal(context.intent, "weekly");
    assert.equal(context.destination.area, "Projections");
  }
});

test("direct auth back links reach the public landing while public and join returns remain intact", () => {
  for (const next of ["/tools/dfs", "/projections/season", "/account", "/hub/home"]) {
    const context = authSessionContext(`?next=${encodeURIComponent(next)}`);
    assert.equal(context.backTo, "/");
    assert.equal(context.next, next);
  }
  assert.equal(authSessionContext("").backTo, "/");
  for (const next of ["/terms", "/privacy", "/lobby/fixture", "/team-room/fixture", "/hub/draft?claim=fixture%2Ftoken", "/hub/home?invite=fixture%2Btoken"]) {
    const context = authSessionContext(`?next=${encodeURIComponent(next)}`);
    assert.equal(context.backTo, next);
    assert.equal(context.next, next);
  }
});

test("auth destinations reject encoded external redirects, control characters and auth loops", () => {
  for (const next of ["/\\evil.example", "/%5cevil.example", "/%2fevil.example", "/%252fevil.example", "/\n/evil.example", "/%0d%0aevil", "/%61uth/callback?token=fixture", "/foo/../login", "/auth", "/signup#page", "/%broken"]) {
    assert.equal(safeAuthNext(next), "/projections/weekly", next);
  }
  assert.equal(safeAuthNext("/authentication"), "/authentication");
});

function memoryStorage() {
  const values = new Map();
  return { values, getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
}

test("email verification remembers only a known landing intent and expires it after one day", () => {
  const storage = memoryStorage();
  assert.equal(rememberLandingAuthIntent("tools", storage, 1000), true);
  assert.equal(readLandingAuthIntent(storage, 2000), "tools");
  assert.deepEqual(JSON.parse([...storage.values.values()][0]), { intent: "tools", createdAt: 1000 });
  assert.equal(rememberLandingAuthIntent("/hub/home?invite=fixture-secret", storage, 2000), false);
  assert.equal(readLandingAuthIntent(storage, 24 * 60 * 60 * 1000 + 1001), null);
  assert.equal(storage.values.size, 0);
  rememberLandingAuthIntent("fantasy", storage, 1000);
  clearLandingAuthIntent(storage);
  assert.equal(readLandingAuthIntent(storage, 2000), null);
});

test("verification intent rejects malformed, unknown or future records and tolerates unavailable storage", () => {
  const storage = memoryStorage();
  for (const value of ["broken-json", JSON.stringify({ intent: "//evil.example", createdAt: 1000 }), JSON.stringify({ intent: "tools", createdAt: "1000" }), JSON.stringify({ intent: "tools", createdAt: 5000 })]) {
    storage.setItem("scoresense:landing-auth-intent", value);
    assert.equal(readLandingAuthIntent(storage, 2000), null);
    assert.equal(storage.values.size, 0);
  }
  const denied = { getItem: () => { throw new Error("Storage denied"); }, setItem: () => { throw new Error("Storage denied"); }, removeItem: () => { throw new Error("Storage denied"); } };
  assert.equal(rememberLandingAuthIntent("weekly", denied), false);
  assert.equal(readLandingAuthIntent(denied), null);
  assert.doesNotThrow(() => clearLandingAuthIntent(denied));
});
