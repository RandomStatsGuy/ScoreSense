import assert from "node:assert/strict";
import test from "node:test";
import { createPortfolioBatch, auditPortfolio } from "./dfsPortfolio.js";
import { previewPortfolioReplacement, applyPortfolioReplacement, portfolioSupportingLineups, validatePortfolioReplacementLineage, auditPortfolioRules } from "./dfsPortfolioReview.js";

const slots = ["QB", "RB1", "RB2", "WR1", "WR2", "WR3", "TE", "FLEX", "DST"];
const positions = ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "RB", "DST"];
function source(offset = 0, count = 1) {
  const salaryCatalog = Array.from({ length: 170 }, (_, i) => ({ player_id: `p${i}`, dfs_id: String(i + 1),
    Player: `Player ${i}`, Position: positions[i] || "WR", Team: i % 2 ? "BUF" : "KC", Opponent: i % 2 ? "KC" : "BUF", salary: 4000 }));
  const lineups = Array.from({ length: count }, (_, n) => ({ total_salary: 36000, total_points: 90,
    lineup: slots.map((slot, i) => { const p = salaryCatalog[i === 5 ? 9 + offset + n : i];
      return { slot, player_id: p.player_id, dfs_id: p.dfs_id, player: p.Player, team: p.Team,
        position: p.Position, salary: p.salary, proj: 10, floor: 5, ceiling: 15 }; }) }));
  return { context: { site: "draftkings", season: 2026, week: 5, slateId: "main", source: "live" },
    salaryCatalog, salarySnapshot: { id: "salary:main" }, slateName: "Main", lineups,
    settings: { locked_player_ids: ["p0"], snapshot_at: "2026-10-11T12:00:00Z", build_snapshot: null } };
}
const batch = (offset = 0, count = 1, id = "a") => createPortfolioBatch(source(offset, count), id, id);
const rules = (players = {}, groups = []) => ({ version: 1, players, groups });
function globalSource(offset = 0, count = 2) {
  const result = source(offset, count);
  Object.assign(result.settings, { portfolio_mode: "global", lineup_count: count, salary_cap: 50000, max_exposure: 1,
    max_overlap: 8, player_exposure_limits: {}, group_exposure_limits: [], excluded_player_ids: [], block_qb_opposing_dst: false });
  result.settings.build_snapshot = { id: `build:${offset}`, content: { parameters: structuredClone(result.settings) } };
  return result;
}

test("combined audit counts pairs across RB/FLEX and every batch, with truthful structure", () => {
  const b = source(1), rows = b.lineups[0].lineup;
  [rows[1].slot, rows[7].slot] = [rows[7].slot, rows[1].slot];
  const audit = auditPortfolio([batch(), createPortfolioBatch(b, "b", "b")]);
  const pair = audit.structure.pairs.find(p => p.player_ids.join(",") === "p1,p7");
  assert.equal(pair.count, 2); assert.equal(pair.rb, true); assert.equal(pair.batchCount, 2);
  assert.equal(audit.structure.flex.RB, 2); assert.equal(audit.structure.flex.TE, 0);
  assert.equal(audit.structure.quarterbacks[0].count, 2);
  assert.equal(audit.structure.qbGames[0].count, 2);
  assert.equal(audit.structure.stackSizes.reduce((n, s) => n + s.count, 0), 2);
  assert.equal(audit.structure.salary.min, 36000);
  assert.equal(audit.structure.projectionSum, 180);
});

test("unknown game identity remains unknown and conditional roles are descriptive", () => {
  const s = source(); s.salaryCatalog.forEach(p => { delete p.Opponent; });
  s.lineups[0].lineup[1].injury_status = "Questionable";
  const audit = auditPortfolio([createPortfolioBatch(s, "a", "a")]);
  assert.equal(audit.structure.qbGames[0].relationship_known, false);
  assert.equal(audit.structure.stackSizes[0].bring_back, null);
  assert.equal(audit.structure.injuryAssumptions[0].player_ids[0], "p1");
});

test("unknown QB or eligible skill-player team is unknown structure rather than zero", () => {
  for (const index of [0, 3]) {
    const s = { ...source(), id: "unknown", label: "Unknown" };
    s.lineups[0].lineup[index].team = "NAN"; s.salaryCatalog[index].Team = "NAN";
    const result = auditPortfolio([s]).structure.stackSizes[0];
    assert.equal(result.attachments, null); assert.equal(result.bring_back, null);
  }
});

test("collection player and pair hard bounds gate while target misses stay soft", () => {
  const b = [batch(0, 3)];
  const r = rules({ p0: { min: "3", max: 3, target: 2.5 }, p100: { min: 1 } },
    [{ id: "rb-core", player_ids: ["p1", "p2"], min: 0, max: 2, target: 1.5 }]);
  const audit = auditPortfolio(b, {}, r);
  assert.ok(audit.errors.some(e => /Player 100|p100/.test(e)));
  assert.ok(audit.errors.some(e => /rb-core/.test(e)));
  assert.equal(audit.bounds.players.find(p => p.id === "p0").targetMiss, 0.5);
  assert.equal(audit.bounds.groups[0].actual, 3);
  assert.equal(auditPortfolio(b, {}, rules({ p0: { target: "2.5" } })).errors.length, 0);
  assert.equal(auditPortfolio(b, { p0: 2 }, rules({ p0: { max: 3 } })).errors.length, 1);
});

test("malformed, contradictory, unknown and repeated group controls block atomically", () => {
  const b = [batch()];
  for (const r of [rules({ p0: { min: 0.5 } }), rules({ p0: { min: 2, max: 1 } }),
    rules({ missing: { max: 1 } }), rules({}, [{ id: "core", player_ids: ["p1", "p1"] }]),
    rules({}, [{ id: "core", player_ids: ["p1", "p2"] }, { id: "other", player_ids: ["p2", "p1"] }]),
    { version: 2, players: {}, groups: [] }]) assert.ok(auditPortfolio(b, {}, r).errors.length);
});

test("affected lineup selector is bounded, stable and uses canonical IDs across slots", () => {
  const b = [batch(0, 3), batch(3, 2, "b")];
  const rows = portfolioSupportingLineups(b, ["p1", "p7"], 1, 2);
  assert.equal(rows.total, 5); assert.equal(rows.rows.length, 2);
  assert.deepEqual(rows.rows.map(r => [r.batchId, r.lineupIndex]), [["a", 2], ["b", 0]]);
});

test("replacement previews freeze before/after deltas and only explicit apply changes collection", () => {
  const original = [batch(0, 2), batch(2, 1, "b")], candidate = source(3, 2);
  candidate.lineups[0].total_points = 91; candidate.lineups[0].lineup[0].proj = 11;
  const preview = previewPortfolioReplacement(original, "a", candidate);
  assert.equal(preview.canApply, true); assert.notEqual(preview.candidateBatches[0].id, "a");
  assert.equal(preview.before.total, 3); assert.equal(preview.after.total, 3);
  assert.equal(preview.delta.projectionSum, 1); assert.equal(preview.delta.removedLineups, 2);
  assert.equal(preview.delta.addedLineups, 2); assert.equal(preview.delta.unchangedLineups, 1);
  assert.ok(preview.playerDeltas.some(p => p.id === "p9" && p.delta === -1));
  assert.equal(original[0].lineups[0].lineup[5].player_id, "p9");
  const result = applyPortfolioReplacement(preview, original, candidate);
  assert.equal(result[1], preview.candidateBatches[1]);
  assert.throws(() => { preview.candidateBatches[0].lineups[0].total_points = 0; }, TypeError);
});

test("replacement rejects stale collection, source and bounds and never substitutes players", () => {
  const original = [batch()], candidate = source(1), r = rules({ p0: { max: 1 } });
  const preview = previewPortfolioReplacement(original, "a", candidate, {}, r);
  assert.throws(() => applyPortfolioReplacement(preview, [...original, batch(2, 1, "b")], candidate, {}, r), /changed|stale/i);
  const changed = structuredClone(candidate); changed.settings.note = "changed";
  assert.throws(() => applyPortfolioReplacement(preview, original, changed, {}, r), /changed|stale/i);
  assert.throws(() => applyPortfolioReplacement(preview, original, candidate, {}, rules()), /changed|stale/i);
});

test("replacement keeps original locks and positive core minima, and gates duplicates and incompatibility", () => {
  const a = structuredClone(batch()); a.settings.locked_player_ids = ["p9"];
  const locked = previewPortfolioReplacement([a], "a", source(1));
  assert.equal(locked.canApply, false); assert.ok(locked.blockers.some(e => /lock/i.test(e)));
  const core = structuredClone(batch()); core.settings.group_exposure_limits = [{ id: "core", player_ids: ["p1", "p9"], min: { count: 1 } }];
  assert.equal(previewPortfolioReplacement([core], "a", source(1)).canApply, false);
  assert.equal(previewPortfolioReplacement([batch(), batch(1, 1, "b")], "a", source(1)).canApply, false);
  const wrong = source(1); wrong.salarySnapshot.id = "different";
  assert.throws(() => previewPortfolioReplacement([batch()], "a", wrong), /different|catalog/i);
  const capped = previewPortfolioReplacement([batch()], "a", source(1, 2), {}, rules({ p0: { max: 1 } }));
  assert.equal(capped.canApply, false);
  assert.throws(() => applyPortfolioReplacement(capped, [batch()], source(1, 2), {}, rules({ p0: { max: 1 } })), /maximum|bound|exceeds/i);
});

test("selected-lineup replacement retains original N and other lineups with flat truthful lineage", () => {
  const original = [batch(0, 3)], candidate = source(4, 2);
  const preview = previewPortfolioReplacement(original, "a", candidate, {}, null, { lineupIndex: 1, candidateIndex: 0 });
  assert.equal(preview.canApply, true); assert.equal(preview.after.total, 3);
  assert.deepEqual(preview.candidateBatches[0].lineups[0], original[0].lineups[0]);
  assert.equal(preview.candidateBatches[0].lineups[1].lineup[5].player_id, "p13");
  assert.equal(preview.delta.removedLineups, 1); assert.equal(preview.delta.addedLineups, 1);
  const composed = applyPortfolioReplacement(preview, original, candidate);
  assert.equal(composed[0].settings.replacement_manifest.replacements.length, 1);
  assert.equal(composed[0].settings.portfolio_selection, null);
  const next = previewPortfolioReplacement(composed, composed[0].id, source(6), {}, null, { lineupIndex: 2, candidateIndex: 0 });
  assert.equal(next.candidateBatches[0].settings.replacement_manifest.replacements.length, 2);
  assert.equal(next.candidateBatches[0].settings.replacement_manifest.replacements[0].candidate_source.settings.replacement_manifest, undefined);
  assert.throws(() => previewPortfolioReplacement(composed, composed[0].id, composed[0]), /nested|normal/i);
});

test("selected replacement independently rechecks original native bounds on original frozen N", () => {
  const s = globalSource();
  s.settings.player_exposure_limits = { p9: { min: { count: 1 }, max: { count: 1 } } };
  s.settings.build_snapshot.content.parameters.player_exposure_limits = structuredClone(s.settings.player_exposure_limits);
  const original = [createPortfolioBatch(s, "Original", "a")];
  const candidate = globalSource(4, 1);
  const preview = previewPortfolioReplacement(original, "a", candidate, {}, null, { lineupIndex: 0, candidateIndex: 0 });
  assert.equal(preview.canApply, false); assert.ok(preview.blockers.some(e => /p9.*minimum|p9.*actual/i.test(e)));
  assert.equal(preview.after.total, 2); assert.equal(preview.before.requestedCount, 2);
  const invalidSource = globalSource(4, 1); invalidSource.settings.player_exposure_limits = { p13: { max: { count: 0 } } };
  invalidSource.settings.build_snapshot.content.parameters.player_exposure_limits = structuredClone(invalidSource.settings.player_exposure_limits);
  assert.throws(() => previewPortfolioReplacement(original, "a", invalidSource, {}, null, { lineupIndex: 0, candidateIndex: 0 }), /actual|maximum/i);
});

test("lineage is independently audited at export against selected full source and source hard rules", () => {
  const original = [batch(0, 2)], candidate = globalSource(4, 1);
  const preview = previewPortfolioReplacement(original, "a", candidate, {}, null, { lineupIndex: 0, candidateIndex: 0 });
  assert.equal(preview.canApply, true);
  assert.equal(validatePortfolioReplacementLineage(preview.candidateBatches[0]).replacements[0].sourceAudit.actualCount, 1);
  const forged = structuredClone(preview.candidateBatches[0]);
  forged.settings.replacement_manifest.replacements[0].candidate_source.lineups[0].lineup[0].proj = 12;
  assert.ok(auditPortfolio([forged]).errors.some(e => /changed|preview/i.test(e)));
  const badBounds = structuredClone(preview.candidateBatches[0]), src = badBounds.settings.replacement_manifest.replacements[0].candidate_source;
  src.settings.player_exposure_limits = { p13: { max: { count: 0 } } };
  src.settings.build_snapshot.content.parameters.player_exposure_limits = structuredClone(src.settings.player_exposure_limits);
  assert.ok(auditPortfolio([badBounds]).errors.some(e => /actual|maximum/i.test(e)));
});

test("whole-batch replacement preserves original minimum counts if candidate count changes", () => {
  const original = structuredClone(batch(0, 3));
  original.settings.group_exposure_limits = [{ id: "core", player_ids: ["p1", "p2"], min: "0.5" }];
  const preview = previewPortfolioReplacement([original], "a", source(4, 1));
  assert.equal(preview.canApply, false); assert.ok(preview.blockers.some(e => /preserved minimum 2/i.test(e)));
});

test("canonical IDs cannot disappear into inherited JavaScript object properties", () => {
  const input = JSON.parse('{"version":1,"players":{"__proto__":{"max":0}},"groups":[]}');
  const result = auditPortfolioRules([{ salaryCatalog: [{ player_id: "__proto__", Player: "Canonical", salary: 4000 }], lineups: [] }], [{ id: "__proto__", count: 1 }], input);
  assert.equal(result.players.length, 1); assert.equal(result.errors.length, 1);
});
