import assert from "node:assert/strict";
import test from "node:test";

import {
  ADMIN_COPY,
  adminLinkAccountRef,
  adminLinkSuccess,
  openAdminFranchises,
} from "./adminPresentation.js";

test("admin link copy tells staff what happens next", () => {
  assert.match(ADMIN_COPY.linkExisting.hint, /franchise|team/i);
  assert.match(ADMIN_COPY.linkExisting.action, /link/i);
  assert.doesNotMatch(ADMIN_COPY.linkExisting.action, /Submit|Draft Hub|permission/i);
  assert.doesNotMatch(ADMIN_COPY.linkExisting.hint, /Draft Hub/i);
});

test("admin link success names the account and franchise", () => {
  assert.equal(
    adminLinkSuccess({ email: "owner@mail.com", team: "Night Owls" }),
    "Linked owner@mail.com to Night Owls. They will see that team in Fantasy.",
  );
});

test("admin link accepts email or native user sub", () => {
  assert.deepEqual(adminLinkAccountRef("  owner@mail.com "), { email: "owner@mail.com" });
  assert.deepEqual(adminLinkAccountRef("ss:abc-123"), { user_sub: "ss:abc-123" });
  assert.deepEqual(adminLinkAccountRef(""), {});
});

test("open admin franchises hides claimed and bot seats", () => {
  const open = openAdminFranchises([
    { id: "a", name: "Open", user_sub: null },
    { id: "b", name: "Taken", user_sub: "ss:1" },
    { id: "c", name: "Bot", is_bot: true },
  ]);
  assert.deepEqual(open.map((t) => t.id), ["a"]);
});

import {
  ADMIN_OPS_COPY,
  adminAttentionCopy,
  adminAttentionSummary,
  adminBytes,
  adminDuration,
  adminExportFilename,
  adminMinuteOptions,
  adminOverviewHeading,
  adminPercent,
  adminProcessLabel,
  adminScheduleLabel,
  adminSeconds,
  adminWhen,
  sortAdminUsage,
} from "./adminPresentation.js";

test("overview heading counts what needs attention", () => {
  assert.equal(adminOverviewHeading(0), "Everything is running");
  assert.equal(adminOverviewHeading(1), "One thing needs you");
  assert.equal(adminOverviewHeading(2), "Two things need you");
  assert.equal(adminOverviewHeading(9), "9 things need you");
});

test("attention summary names the problems in a sentence", () => {
  const items = [
    { kind: "job", id: "sentiment_refresh", label: "Sentiment refresh", at: "2026-10-06T12:02:00Z" },
    { kind: "cache", id: "draft:2026", cache_kind: "draft", season: 2026, status: "missing" },
  ];
  assert.equal(adminAttentionSummary(items), "Sentiment refresh failed, and draft pool 2026 is missing.");
  assert.equal(adminAttentionSummary([]), ADMIN_OPS_COPY.overview.calmSupport);
});

test("attention copy offers the fix that actually applies", () => {
  assert.equal(adminAttentionCopy({ kind: "job", label: "Weekly refresh", at: "2026-10-06T10:00:00Z" }).action, "Retry");
  assert.equal(adminAttentionCopy({ kind: "disk", percent: 91.2 }).action, null);
  assert.match(adminAttentionCopy({ kind: "errors", count: 1 }).title, /1 server error in/);
});

test("schedule labels are Pacific wall-clock and say when a job is manual", () => {
  assert.equal(adminScheduleLabel({ schedule: { enabled: true, repeat: "weekly", weekday: 1, at_time: "03:00" } }), "Tue 3:00 AM");
  assert.equal(adminScheduleLabel({ schedule: { enabled: true, repeat: "daily", at_time: "17:30" } }), "Daily 5:30 PM");
  assert.equal(adminScheduleLabel({ schedule: { enabled: false, repeat: "daily", at_time: "17:30" } }), "Manual only");
  assert.equal(adminScheduleLabel({ automatic: true, id: "season_refresh" }), "Automatic");
});

test("when labels collapse to today, weekday, or date in Pacific time", () => {
  const now = new Date("2026-10-07T04:00:00Z"); // Oct 6, 9:00 PM PT
  assert.equal(adminWhen("2026-10-06T10:00:00Z", now), "Today 3:00 AM");
  assert.equal(adminWhen("2026-10-04T17:10:00Z", now), "Sun 10:10 AM");
  assert.equal(adminWhen("2026-09-13T17:10:00Z", now), "Sep 13");
  assert.equal(adminWhen(null, now), "\u2014");
});

test("sizes and durations read the way the mock shows them", () => {
  assert.equal(adminBytes(212 * 1024 ** 2), "212 MB");
  assert.equal(adminBytes(1.4 * 1024 ** 3), "1.4 GB");
  assert.equal(adminDuration(130), "2m 10s");
  assert.equal(adminDuration(18 * 60 + 42), "18m 42s");
});

test("minute options stay inside the setting bounds and keep the saved value", () => {
  const ids = adminMinuteOptions({ min: 5, max: 60 }, 7).map((o) => o.id);
  assert.ok(ids.includes("7"));
  assert.ok(!ids.includes("2"));
  assert.ok(!ids.includes("90"));
  assert.equal(adminMinuteOptions({ min: 15, max: 1440 }, 180).find((o) => o.id === "180").label, "Every 3 hours");
});

test("ops copy avoids banned phrasing", () => {
  const text = JSON.stringify(ADMIN_OPS_COPY);
  assert.doesNotMatch(text, /Submit|Draft Hub|You do not have permission/);
});

test("task manager labels name processes without command lines", () => {
  assert.equal(adminProcessLabel({ role: "api", name: "python" }), "ScoreSense API");
  assert.equal(adminProcessLabel({ role: "cpu_worker", name: "python" }), "Background worker");
  assert.equal(adminProcessLabel({ role: "child", name: "node" }), "Helper (node)");
});

test("small CPU and time readings never round to zero", () => {
  assert.equal(adminPercent(0.4), "<1%");
  assert.equal(adminPercent(0), "0%");
  assert.equal(adminPercent(49.6), "50%");
  assert.equal(adminPercent(null), "—");
  assert.equal(adminSeconds(0.2), "<1s");
  assert.equal(adminSeconds(null), "—");
});

test("usage sorts heaviest first and treats missing values as zero", () => {
  const rows = [{ job: "a", peak_rss: null, cpu_s: 2 }, { job: "b", peak_rss: 900, cpu_s: 1 }];
  assert.deepEqual(sortAdminUsage(rows, "peak_rss").map((row) => row.job), ["b", "a"]);
  assert.deepEqual(sortAdminUsage(rows, "cpu_s").map((row) => row.job), ["a", "b"]);
  assert.deepEqual(sortAdminUsage(null), []);
});

test("export copy says where the numbers go", () => {
  assert.equal(adminExportFilename("jobs", new Date(2026, 9, 7, 9, 5)), "scoresense-jobs-20261007-0905.json");
  assert.match(ADMIN_OPS_COPY.export.copied, /chat/i);
  assert.doesNotMatch(Object.values(ADMIN_OPS_COPY.export).join(" "), /Submit|permission/i);
});