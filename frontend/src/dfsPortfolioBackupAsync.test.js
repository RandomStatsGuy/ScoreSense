import assert from "node:assert/strict";
import test from "node:test";
import { createPortfolioBatch } from "./dfsPortfolio.js";
import { readPortfolioBackup, writePortfolioBackup, PORTFOLIO_BACKUP_MAX_BYTES } from "./dfsPortfolioBackup.js";
import { downloadPortfolioBackupAsync, readPortfolioBackupAsync, readPortfolioBackupFileAsync, writePortfolioBackupAsync } from "./dfsPortfolioBackupAsync.js";

const timestamp = "2026-10-11T12:00:00Z";
function fixture() {
  const slots = ["QB", "RB1", "RB2", "WR1", "WR2", "WR3", "TE", "FLEX", "DST"], positions = ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "RB", "DST"];
  const salaryCatalog = slots.map((_, i) => ({ player_id: `p${i}`, dfs_id: String(100 + i), Player: `Player ${i}`, Position: positions[i], Team: "BUF", salary: 4000 }));
  const lineups = [{ total_salary: 36000, total_points: 90, lineup: slots.map((slot, i) => ({ slot, player_id: `p${i}`, dfs_id: String(100 + i),
    player: `Player ${i}`, position: positions[i], team: "BUF", salary: 4000, proj: 10, floor: 5, ceiling: 15 })) }];
  return [createPortfolioBatch({ context: { site: "draftkings", season: 2026, week: 5, slateId: "main", source: "live" },
    slateName: "Main", salaryCatalog, salarySnapshot: null, lineups, settings: { build_snapshot: null, snapshot_at: timestamp } }, "Original", "original")];
}
const rules = { version: 1, players: { p0: { min: 1, target: 0.5, max: 1 } }, groups: [] };

test("workerless async round trip runs real compact writer/reader and restores frozen bounds and history", async () => {
  assert.equal(typeof Worker, "undefined");
  const batches = fixture(), json = await writePortfolioBackupAsync(batches, { p0: 1 }, timestamp, { reviewRules: rules });
  const restored = await readPortfolioBackupFileAsync({ size: Buffer.byteLength(json), text: async () => json });
  assert.equal(JSON.parse(json).version, 2); assert.deepEqual(restored.batches, batches); assert.deepEqual(restored.reviewRules, rules);
  assert.equal(restored.exportedAt, timestamp); assert.ok(Object.isFrozen(restored.batches[0].lineups[0].lineup[0]));
  assert.throws(() => { restored.batches[0].lineups[0].lineup[0].proj = 0; }, TypeError);
  const legacy = await writePortfolioBackupAsync(batches, {}, timestamp, { version: 1 });
  assert.equal(JSON.parse(legacy).version, 1); assert.equal((await readPortfolioBackupAsync(legacy)).batches.length, 1);
});

test("oversized files reject before reading bytes and malformed JSON never returns replacement state", async () => {
  let read = false;
  await assert.rejects(readPortfolioBackupFileAsync({ size: PORTFOLIO_BACKUP_MAX_BYTES + 1, text: async () => { read = true; return "{}"; } }), /20 MiB/);
  assert.equal(read, false); await assert.rejects(readPortfolioBackupAsync("{"), /malformed/);
});

test("worker bridge terminates after success and real validation errors; transferred objects refreeze", async () => {
  const instances = [], originalWorker = globalThis.Worker;
  class TestWorker {
    constructor(url, options) { assert.ok(url.href.endsWith("dfsPortfolioBackup.worker.js")); assert.equal(options.type, "module"); instances.push(this); }
    postMessage(request) {
      queueMicrotask(() => { try {
        const value = request.operation === "write" ? writePortfolioBackup(request.batches, request.limits, request.exportedAt, request.options) : structuredClone(readPortfolioBackup(request.json));
        this.onmessage({ data: { ok: true, value } });
      } catch (error) { this.onmessage({ data: { ok: false, error: error.message } }); } });
    }
    terminate() { this.terminated = true; }
  }
  globalThis.Worker = TestWorker;
  try {
    const json = await writePortfolioBackupAsync(fixture(), {}, timestamp, { reviewRules: rules });
    const restored = await readPortfolioBackupAsync(json);
    assert.ok(Object.isFrozen(restored.batches[0].salaryCatalog[0]));
    await assert.rejects(readPortfolioBackupAsync("{"), /malformed/);
    assert.equal(instances.length, 3); assert.ok(instances.every(worker => worker.terminated && worker.onmessage === null));
  } finally { if (originalWorker === undefined) delete globalThis.Worker; else globalThis.Worker = originalWorker; }
});

test("worker construction/post errors propagate without synchronous fallback; stale download gate runs before DOM", async () => {
  const originalWorker = globalThis.Worker; let terminated = false;
  globalThis.Worker = class { postMessage() { throw new Error("Clone failed"); } terminate() { terminated = true; } };
  try { await assert.rejects(writePortfolioBackupAsync(fixture()), /Clone failed/); assert.equal(terminated, true); }
  finally { if (originalWorker === undefined) delete globalThis.Worker; else globalThis.Worker = originalWorker; }
  await assert.rejects(downloadPortfolioBackupAsync(fixture(), {}, rules, { beforeDownload: () => { throw new Error("Changed account"); } }), /Changed account/);
});
