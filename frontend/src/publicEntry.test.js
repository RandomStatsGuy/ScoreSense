import test from "node:test";
import assert from "node:assert/strict";
import { authRouteState, isPublicAuthPath, isPublicLandingPath, isPublicProjectionPath, isDraftJoinPreview, requiresProductAccount, publicSectionPath, publicRootRedirect } from "./publicEntry.js";

test("all marketing entries stay public before and after either auth configuration", () => {
  for (const authRequired of [true, false]) {
    for (const ready of [false, true]) {
      for (const pathname of ["/", "/projections", "/fantasy", "/tools", "/tools/"]) {
        assert.equal(isPublicLandingPath(pathname), true);
        assert.equal(authRouteState({ pathname, ready, authRequired, authenticated: false }), "allow");
        assert.equal(authRouteState({ pathname, ready, authRequired, authenticated: true }), "allow");
      }
      assert.equal(publicRootRedirect({ ready, authenticated: false }), null);
    }
  }
});

test("private screens wait for identity and account products cannot use disabled local auth", () => {
  for (const pathname of ["/hub", "/hub/home", "/hub/draft", "/hub/trades", "/tools/dfs", "/tools/mock-draft", "/tools/best-ball", "/model"]) {
    assert.equal(requiresProductAccount(pathname), true);
    assert.equal(isPublicAuthPath(pathname), false, pathname);
    assert.equal(authRouteState({ pathname, ready: false, authRequired: false, authenticated: true }), "loading");
    assert.equal(authRouteState({ pathname, ready: true, authRequired: true, authenticated: false }), "signin");
    assert.equal(authRouteState({ pathname, ready: true, authRequired: false, authenticated: false }), "signin");
    assert.equal(authRouteState({ pathname, ready: true, authRequired: true, authenticated: true }), "allow");
  }
});

test("full weekly and season Projections remain public regardless configured authentication", () => {
  for (const pathname of ["/projections/weekly", "/projections/weekly/injuries", "/projections/weekly/fantasy", "/projections/weekly/narrative", "/projections/season", "/projections/season/preseason", "/projections/season/live", "/projections/season/live/narrative"]) {
    assert.equal(isPublicProjectionPath(pathname), true, pathname);
    assert.equal(isPublicAuthPath(pathname, "?player=read-only-inspector"), true);
    assert.equal(authRouteState({ pathname, ready: false }), "allow", "free projections do not wait on auth services");
    for (const authRequired of [true, false]) {
      assert.equal(authRouteState({ pathname, ready: true, authRequired, authenticated: false }), "allow");
    }
  }
});

test("public projection and product paths do not expose private or unknown siblings", () => {
  for (const pathname of ["/projections/admin", "/projections/weekly-extra", "/projections/weekly/one/two", "/projections/season/a/b/c", "/fantasy/private", "/tools/dfs", "/tools-extra", "/hub/home"]) {
    assert.equal(isPublicProjectionPath(pathname), false, pathname);
    assert.equal(isPublicAuthPath(pathname), false, pathname);
  }
});

test("unrelated routes retain their existing configured gate and fallback behavior", () => {
  for (const pathname of ["/account", "/admin", "/unknown"]) {
    assert.equal(authRouteState({ pathname, ready: false }), "loading");
    assert.equal(authRouteState({ pathname, ready: true, authRequired: true, authenticated: false }), "signin");
    assert.equal(authRouteState({ pathname, ready: true, authRequired: false, authenticated: false }), "allow");
  }
});

test("anonymous cross-area links open the focused landing without changing signed-in destinations", () => {
  assert.equal(publicSectionPath("projections", { currentView: "hub" }), "/projections");
  assert.equal(publicSectionPath("hub", { currentView: "projections" }), "/fantasy");
  assert.equal(publicSectionPath("tools", { currentView: "projections" }), "/tools");
  for (const section of ["projections", "hub", "tools"]) {
    assert.equal(publicSectionPath(section, { authenticated: true, currentView: "model" }), null);
    assert.equal(publicSectionPath(section, { authenticated: false, currentView: section }), null, "selected phone tab keeps its picker");
  }
  for (const section of ["admin", "model", "unknown", "constructor"]) assert.equal(publicSectionPath(section), null);
});

test("established root session keeps Weekly filters and anchor after identity settles", () => {
  const location = { search: "?pos=qb&week=6", hash: "#players", authenticated: true };
  assert.equal(publicRootRedirect({ ...location, ready: false }), null);
  assert.equal(publicRootRedirect({ ...location, ready: true }), "/projections/weekly?pos=qb&week=6#players");
});

test("root invite and claim links bypass the marketing page with only their join tokens", () => {
  for (const ready of [false, true]) {
    for (const authenticated of [false, true]) {
      assert.equal(publicRootRedirect({
        search: "?invite=%20token%2Fone%20&next=https%3A%2F%2Fevil.example&week=6",
        hash: "#join",
        ready,
        authenticated,
      }), "/hub/draft?invite=token%2Fone#join");
      assert.equal(publicRootRedirect({ search: "?claim=team-token&pos=qb", ready, authenticated }), "/hub/draft?claim=team-token");
    }
  }
  assert.equal(publicRootRedirect({ search: "?invite=&claim=%20" }), null);
  assert.equal(publicRootRedirect({ search: "?invite=one&claim=two&token=unrelated" }), "/hub/draft?invite=one&claim=two");
});

test("session and room links stay public; invite/claim previews are limited to Draft", () => {
  for (const pathname of ["/login", "/register", "/signup", "/terms", "/privacy", "/sms-alerts", "/auth/callback", "/auth/verify", "/auth/reset-password", "/auth/forgot-password", "/lobby/ABC123", "/team-room/example-token"]) {
    assert.equal(isPublicAuthPath(pathname), true, pathname);
    assert.equal(authRouteState({ pathname, ready: true, authRequired: true, authenticated: false }), "allow");
    assert.equal(authRouteState({ pathname, ready: false }), "loading");
  }
  assert.equal(isPublicAuthPath("/hub/draft", "?invite=token"), true);
  assert.equal(isPublicAuthPath("/hub/draft", "?claim=token"), true);
  for (const search of ["?invite=token", "?claim=token"]) {
    assert.equal(isDraftJoinPreview("/hub/draft", search), true);
    for (const authRequired of [true, false]) assert.equal(authRouteState({ pathname: "/hub/draft", search, ready: true, authRequired, authenticated: false }), "allow");
    for (const pathname of ["/hub/home", "/hub/trades", "/tools/dfs", "/model"]) {
      assert.equal(isPublicAuthPath(pathname, search), false);
      assert.equal(authRouteState({ pathname, search, ready: true, authRequired: false, authenticated: false }), "signin");
    }
  }
  for (const search of ["?invite=", "?claim=%20", "?other=token"]) assert.equal(isDraftJoinPreview("/hub/draft", search), false);
});


test("route access follows React Router's decoded and case-insensitive paths", () => {
  for (const pathname of ["/TOOLS/dfs", "/Hub/home", "/MODEL", "/t%6fols/dfs", "/h%75b/home", "/%6dodel"]) {
    assert.equal(authRouteState({ pathname, ready: true, authRequired: false, authenticated: false }), "signin", pathname);
  }
  for (const pathname of ["/Projections/weekly", "/PROJECTIONS/season/live", "/FANTASY", "/LOGIN", "/Auth/verify", "/%70rojections/weekly", "/%6Cogin"]) {
    assert.equal(authRouteState({ pathname, ready: true, authRequired: true, authenticated: false }), "allow", pathname);
  }
});
