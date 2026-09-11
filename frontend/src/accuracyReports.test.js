import test from "node:test";
import assert from "node:assert/strict";
import { loadAccuracyReports } from "./accuracyReports.js";

const ok = (value) => ({ ok: true, json: async () => value });

test("all reports start before any response resolves", async () => {
  const pending = new Map();
  const task = loadAccuracyReports("rb", (path) => new Promise((resolve) => pending.set(path, resolve)));
  assert.deepEqual([...pending.keys()], [
    "/api/accuracy?position=rb", "/api/upside?position=rb", "/api/accuracy/season-long?position=rb",
  ]);
  // Reverse completion order must not associate data with the wrong report.
  pending.get("/api/accuracy/season-long?position=rb")(ok("season"));
  pending.get("/api/upside?position=rb")(ok("upside"));
  pending.get("/api/accuracy?position=rb")(ok("primary"));
  assert.deepEqual(await task, { accuracy: "primary", upside: "upside", seasonLong: "season" });
});

test("optional HTTP and network failures retain the primary report", async () => {
  const reports = await loadAccuracyReports("qb", async (path) => {
    if (path.startsWith("/api/accuracy?")) return ok({ count: 5 });
    if (path.startsWith("/api/upside")) return { ok: false, status: 503, text: async () => "" };
    throw new Error("offline");
  });
  assert.deepEqual(reports, { accuracy: { count: 5 }, upside: null, seasonLong: null });
});

test("malformed optional JSON is non-fatal", async () => {
  const reports = await loadAccuracyReports("wr", async (path) => path.startsWith("/api/accuracy?")
    ? ok("primary") : { ok: true, json: async () => { throw new SyntaxError("bad JSON"); } });
  assert.deepEqual(reports, { accuracy: "primary", upside: null, seasonLong: null });
});

test("primary failure is surfaced even when optional reports succeed", async () => {
  await assert.rejects(loadAccuracyReports("qb", async (path) => path.startsWith("/api/accuracy?")
    ? { ok: false, status: 503, text: async () => JSON.stringify({ detail: "Report missing" }) }
    : ok("optional")), /Report missing/);
});
