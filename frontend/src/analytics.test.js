import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GA_MEASUREMENT_ID,
  analyticsEnabled,
  buildPageViewPayload,
  initAnalytics,
  pageGroupForPath,
  pageTitleForPath,
  resetAnalyticsForTests,
  sanitizeSearch,
  shouldSkipPageView,
  trackPageView,
} from "./analytics.js";

test("analyticsEnabled only on production hostnames", () => {
  assert.equal(analyticsEnabled("app.fourthdownlabs.com"), true);
  assert.equal(analyticsEnabled("www.fourthdownlabs.com"), true);
  assert.equal(analyticsEnabled("fourthdownlabs.com"), true);
  assert.equal(analyticsEnabled("localhost"), false);
  assert.equal(analyticsEnabled("127.0.0.1"), false);
  assert.equal(analyticsEnabled("scoresense-git-preview.vercel.app"), false);
});

test("sanitizeSearch drops secrets and keeps filters", () => {
  assert.equal(sanitizeSearch(""), "");
  assert.equal(
    sanitizeSearch("?pos=wr&week=1&token=jwt.secret&q=mahomes&compare=1,2&cmp=1"),
    "?pos=wr&week=1",
  );
  assert.equal(sanitizeSearch("?invite=abc&code=oauth"), "");
  assert.equal(
    sanitizeSearch("?season=2026&teams=KC,BUF&movers=risers&draftSeason=2026"),
    "?season=2026&teams=KC%2CBUF&movers=risers&draftSeason=2026",
  );
});

test("shouldSkipPageView skips redirects, callback, and unknown paths", () => {
  assert.equal(shouldSkipPageView("/"), true);
  assert.equal(shouldSkipPageView("/auth/callback"), true);
  assert.equal(shouldSkipPageView("/hub"), true);
  assert.equal(shouldSkipPageView("/hub/insights"), true);
  assert.equal(shouldSkipPageView("/tools"), true);
  assert.equal(shouldSkipPageView("/not-a-real-page"), true);
  assert.equal(shouldSkipPageView("/projections/weekly"), false);
  assert.equal(shouldSkipPageView("/hub/draft"), false);
  assert.equal(shouldSkipPageView("/privacy"), false);
  assert.equal(shouldSkipPageView("/auth/verify"), false);
});

test("pageTitleForPath matches product areas", () => {
  assert.equal(pageTitleForPath("/projections/weekly"), "Projections · Weekly");
  assert.equal(pageTitleForPath("/projections/weekly/injuries"), "Projections · Weekly · Injuries");
  assert.equal(pageTitleForPath("/projections/weekly/fantasy"), "Projections · Weekly · Fantasy");
  assert.equal(pageTitleForPath("/projections/season/preseason"), "Projections · Season · Preseason");
  assert.equal(pageTitleForPath("/projections/season/live"), "Projections · Season · Live");
  assert.equal(pageTitleForPath("/hub/home"), "League · Home");
  assert.equal(pageTitleForPath("/hub/players"), "League · Available players");
  assert.equal(pageTitleForPath("/hub/draft"), "League · Draft");
  assert.equal(pageTitleForPath("/hub/cap"), "League · Cap");
  assert.equal(pageTitleForPath("/hub/insights/spend"), "League · Insights · Spend");
  assert.equal(pageTitleForPath("/hub/insights/scoring"), "League · Insights · Scoring");
  assert.equal(pageTitleForPath("/hub/insights/history"), "League · Insights · History");
  assert.equal(pageTitleForPath("/hub/office/chat"), "League · Office · Chat");
  assert.equal(pageTitleForPath("/hub/office/members"), "League · Office · Members");
  assert.equal(pageTitleForPath("/tools/dfs"), "Tools · DFS");
  assert.equal(pageTitleForPath("/model"), "Model accuracy");
  assert.equal(pageTitleForPath("/admin"), "Admin · Overview");
  assert.equal(pageTitleForPath("/admin/users"), "Admin · Users");
  assert.equal(pageTitleForPath("/privacy"), "Privacy");
});

test("pageGroupForPath buckets by top-level area", () => {
  assert.equal(pageGroupForPath("/projections/weekly"), "projections");
  assert.equal(pageGroupForPath("/hub/draft"), "hub");
  assert.equal(pageGroupForPath("/tools/dfs"), "tools");
  assert.equal(pageGroupForPath("/privacy"), "legal");
  assert.equal(pageGroupForPath("/auth/verify"), "auth");
});

test("buildPageViewPayload sanitizes location and sets title/group", () => {
  const payload = buildPageViewPayload({
    pathname: "/projections/weekly",
    search: "?pos=rb&token=secret",
    origin: "https://example.com",
  });
  assert.equal(payload.page_title, "Projections · Weekly");
  assert.equal(payload.page_path, "/projections/weekly?pos=rb");
  assert.equal(payload.page_location, "https://example.com/projections/weekly?pos=rb");
  assert.equal(payload.page_group, "projections");
});

test("initAnalytics no-ops off production host and loads gtag once on prod", () => {
  resetAnalyticsForTests();
  const localWin = { location: { hostname: "localhost" }, dataLayer: [] };
  const localDoc = { querySelector: () => null, createElement: () => ({}), head: { appendChild() {} } };
  assert.equal(initAnalytics({ hostname: "localhost", win: localWin, doc: localDoc }), false);

  const scripts = [];
  const prodWin = { location: { hostname: "app.fourthdownlabs.com" } };
  const prodDoc = {
    querySelector: () => null,
    createElement: (tag) => {
      const el = { tag, async: false, src: "" };
      return el;
    },
    head: {
      appendChild(el) {
        scripts.push(el);
      },
    },
  };
  assert.equal(
    initAnalytics({
      measurementId: GA_MEASUREMENT_ID,
      hostname: "app.fourthdownlabs.com",
      win: prodWin,
      doc: prodDoc,
    }),
    true,
  );
  assert.equal(typeof prodWin.gtag, "function");
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].src, `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`);
  assert.equal(
    initAnalytics({ hostname: "app.fourthdownlabs.com", win: prodWin, doc: prodDoc }),
    true,
  );
  assert.equal(scripts.length, 1);
});

test("trackPageView sends sanitized page_view and skips callback", () => {
  resetAnalyticsForTests();
  const events = [];
  const win = {
    location: { hostname: "app.fourthdownlabs.com", origin: "https://example.com" },
    gtag(...args) {
      events.push(args);
    },
  };
  const doc = { title: "ScoreSense" };

  assert.equal(trackPageView({ pathname: "/auth/callback", search: "?token=abc" }, { win, doc }), false);
  assert.equal(events.length, 0);

  assert.equal(
    trackPageView({ pathname: "/hub/draft", search: "?token=abc&pos=wr" }, { win, doc }),
    true,
  );
  assert.equal(events.length, 1);
  assert.equal(events[0][0], "event");
  assert.equal(events[0][1], "page_view");
  assert.equal(events[0][2].page_title, "League · Draft");
  assert.equal(events[0][2].page_path, "/hub/draft?pos=wr");
  assert.equal(events[0][2].page_group, "hub");
  assert.equal(doc.title, "League · Draft · ScoreSense");
});
