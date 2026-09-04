import assert from "node:assert/strict";
import test from "node:test";
import { AUTH_COPY, authOauthNext, safeAuthNext } from "./authPresentation.js";

test("auth copy names the goal and skips banned verbs", () => {
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
