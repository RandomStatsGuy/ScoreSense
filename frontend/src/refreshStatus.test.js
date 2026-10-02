import test from "node:test";
import assert from "node:assert/strict";
import { refreshHasFinished, waitForRefreshComplete, waitForContextRefresh, successfulRefreshRevision } from "./refreshStatus.js";

test("refreshHasFinished is false for running or missing timestamps", () => {
  const cutoff = Date.parse("2026-08-17T12:00:00.000Z");
  assert.equal(refreshHasFinished(null, cutoff), false);
  assert.equal(refreshHasFinished({ status: "never_run" }, cutoff), false);
  assert.equal(refreshHasFinished({ status: "running", started_at: "2026-08-17T12:00:01.000Z" }, cutoff), false);
  assert.equal(
    refreshHasFinished(
      { status: "completed", completed_at: "2026-06-24T00:00:00.000Z" },
      cutoff,
    ),
    false,
  );
});

test("refreshHasFinished is true when completed_at is after the click", () => {
  const cutoff = Date.parse("2026-08-17T12:00:00.000Z");
  assert.equal(
    refreshHasFinished(
      { status: "completed", completed_at: "2026-08-17T12:05:00.000Z" },
      cutoff,
    ),
    true,
  );
});

test("refreshHasFinished treats completed without a parseable timestamp as done", () => {
  const cutoff = Date.parse("2026-08-17T12:00:00.000Z");
  assert.equal(
    refreshHasFinished(
      { status: "completed", started_at: "2026-08-17T12:00:01.000Z", completed_at: "not-a-date" },
      cutoff,
    ),
    true,
  );
});

test("refreshHasFinished treats legacy files without status as complete when fresh", () => {
  const cutoff = Date.parse("2026-08-17T12:00:00.000Z");
  assert.equal(
    refreshHasFinished({ completed_at: "2026-08-17T12:01:00.000Z" }, cutoff),
    true,
  );
});

test("refreshHasFinished throws when the job recorded an error", () => {
  assert.throws(
    () => refreshHasFinished({ status: "error", error: "ETL failed" }, Date.now()),
    /ETL failed/,
  );
});

test("waitForRefreshComplete returns after a later completed status", async () => {
  const cutoffMs = Date.parse("2026-08-17T12:00:00.000Z");
  let calls = 0;
  const status = await waitForRefreshComplete({
    cutoffMs,
    intervalMs: 0,
    timeoutMs: 1_000,
    sleep: async () => {},
    fetchStatus: async () => {
      calls += 1;
      if (calls < 3) return { status: "running", started_at: "2026-08-17T12:00:01.000Z" };
      return { status: "completed", completed_at: "2026-08-17T12:02:00.000Z" };
    },
  });
  assert.equal(status.status, "completed");
  assert.equal(calls, 3);
});

test("failed attempts and running jobs retain only the last successful revision", () => {
  assert.equal(successfulRefreshRevision({ status: "error", completed_at: "2026-09-11" }), null);
  assert.equal(successfulRefreshRevision({ status: "error", completed_at: "2026-09-11", last_completed_at: "2026-09-10" }), "2026-09-10");
  assert.equal(successfulRefreshRevision({ status: "running", last_completed_at: "2026-09-10" }), "2026-09-10");
  assert.equal(successfulRefreshRevision({ status: "completed", completed_at: "2026-09-11" }), "2026-09-11");
});

test("notes refresh waits on its own job before the board reloads", async () => {
  const started_at = new Date().toISOString();
  const url = "/api/players/context/refresh/job123";
  let polls = 0;
  const result = await waitForContextRefresh({ status: "running", status_url: url, started_at }, async (path) => {
    assert.equal(path, url);
    polls += 1;
    return polls === 1 ? { status: "running" } : { status: "completed", completed_at: started_at };
  }, { sleep: async () => {}, timeoutMs: 1000 });
  assert.equal(result.status, "completed");
  assert.equal(polls, 2);
});

test("notes refresh reports failure, a missing job, and immediate completion", async () => {
  await assert.rejects(waitForContextRefresh({ status: "error", error: "Worker failed" }), /Worker failed/);
  await assert.rejects(waitForContextRefresh({ status: "running" }), /did not start/);
  const completed = { status: "completed", rows: 830 };
  assert.equal(await waitForContextRefresh(completed, () => assert.fail("already complete")), completed);
});
