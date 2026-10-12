import test from "node:test";
import assert from "node:assert/strict";
import { createNavigationDraftStore } from "./dfsNavigationDraft.js";

const working = () => ({
  context: { site: "draftkings_showdown", season: 2026, week: 5, slateId: "buf-la", source: "live" },
  pool: [{ player_id: "buf-wr", salary: 600, "Projected Points": 2.125 }], salaries: [{ dfs_id: "99", salary: 600 }],
  settings: { objective: "ceiling", exposure: .6, showdownRules: { receiver_captain_qb: "require", approved_qb_ids: { BUF: ["buf-qb"] } } },
  locked: ["buf-qb"], excluded: ["la-rb"], overrides: { "buf-wr": { proj: 3, floor: 0, ceiling: 8 } },
  ownership: { "buf-wr": 4 }, captainLimits: { "buf-wr": .2 }, selected: 7,
  currentBuild: { settings: { build_snapshot: { id: "original-hash", payload: { players: [{ player_id: "buf-wr", score: 2.125 }] } } }, lineups: [{ objective_score: 123.456789 }] },
  lineups: [{ objective_score: 123.456789 }], workspaceUi: { stage: 1, view: "build" },
  projectionImportSource: { name: "my-forecast.csv", count: 1, importedAt: "2026-10-12T10:00:00Z" },
});

test("navigation round trip keeps Showdown context, controls, exact frozen build and review selection", () => {
  const store = createNavigationDraftStore();
  const draft = working();
  assert.equal(store.write("account:a", draft), true);
  assert.deepEqual(store.read("account:a"), draft);
  draft.pool[0]["Projected Points"] = 999;
  const restored = store.read("account:a");
  assert.equal(restored.pool[0]["Projected Points"], 2.125);
  restored.currentBuild.settings.build_snapshot.id = "edited";
  assert.equal(store.read("account:a").currentBuild.settings.build_snapshot.id, "original-hash");
});

test("navigation memory keeps one account only and never restores after account/logout clear", () => {
  const store = createNavigationDraftStore();
  store.write("account:a", working());
  assert.equal(store.read("account:b"), null);
  assert.equal(store.read("account:a"), null);
  store.write("account:a", working());
  store.clear();
  assert.equal(store.read("account:a"), null);
  store.write("browser-local", working());
  assert.equal(store.read("unavailable"), null);
  assert.equal(store.write("unavailable", working()), false);
});

test("navigation memory never retains entry templates, attestations, credentials or download artifacts", () => {
  const store = createNavigationDraftStore();
  const source = { ...working(), token: "secret", template: { entries: ["old"] }, assignments: { 1: 0 }, sameSlate: true,
    exportState: { csv: "old downloaded bytes" }, exportSession: { access: true } };
  store.write("browser-local", source);
  const restored = store.read("browser-local");
  for (const key of ["token", "template", "assignments", "sameSlate", "exportState", "exportSession"]) assert.equal(key in restored, false);
});

test("navigation memory expires, is byte-bounded, and cannot resume a pending build", () => {
  let time = 10;
  const store = createNavigationDraftStore({ now: () => time, maxAgeMs: 100, maxBytes: 4096 });
  const pending = { ...working(), buildJob: { status: "running", startedAt: 1 } };
  assert.equal(store.write("browser-local", pending), true);
  assert.deepEqual(store.read("browser-local").buildJob, { status: "cancelled", startedAt: 1, finishedAt: 10 });
  time = 111;
  assert.equal(store.read("browser-local"), null);
  assert.equal(store.write("browser-local", { ...working(), pool: [{ player_id: "x", Player: "x".repeat(4096) }] }), false);
  assert.equal(store.read("browser-local"), null);
  const circular = working(); circular.pool[0].bad = circular;
  assert.equal(store.write("browser-local", circular), false);
});
