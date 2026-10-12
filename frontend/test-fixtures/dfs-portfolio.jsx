// Production builder/workspace with deterministic, local-only API responses.
import React, { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import LineupOptimizer from "../src/LineupOptimizer.jsx";
import useDfsBuilder from "../src/useDfsBuilder.js";
import DfsWorkspace from "../src/DfsWorkspace.jsx";
import { DEFAULT_FORMATS } from "../src/dfsToolPresentation.js";
import { publishDataRevision } from "../src/useDataRevision.js";
import evidenceFixture from "./dfs-evidence-data.json";
import sharedFixture from "./dfs-shared-data.json";
import contestFixture from "./dfs-contest-data.json";
import "../src/styles.css";
import "../src/styles/color-theme.css";
import "../src/styles/product-hierarchy.css";
import "../src/styles/product-rhythm.css";
import "../src/styles/fantasy-phone.css";
import "../src/styles/standalone-dialogs.css";

const positions = ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "WR", "DST"];
const slots = ["QB", "RB1", "RB2", "WR1", "WR2", "WR3", "TE", "FLEX", "DST"];
const largePool = new URLSearchParams(location.search).has("large-pool");
const sharedMode = new URLSearchParams(location.search).has("shared");
const workflow = sharedMode || new URLSearchParams(location.search).has("workflow");
const evidenceMode = new URLSearchParams(location.search).has("evidence");
const guardrails = workflow || evidenceMode || new URLSearchParams(location.search).has("guardrails");
const historicalFeatures = largePool
  ? Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`model_feature_${i}`, i / 100]))
  : {};
const players = sharedMode ? sharedFixture.ui_pool : evidenceMode ? evidenceFixture.pool : Array.from({ length: largePool ? 700 : workflow ? 400 : 180 }, (_, i) => ({ ...historicalFeatures, player_id: `p${i + 1}`, dfs_id: String(i + 1),
  Player: `Example ${i + 1}`, Team: guardrails && i >= 9 ? "KC" : i % 2 ? "BUF" : "KC",
  Opponent: guardrails && i >= 9 ? "BUF" : i % 2 ? "KC" : "BUF",
  Position: guardrails && i === 178 ? "RB" : positions[i] || "WR", salary: 4000,
  "Projected Points": 10, "Low (P10)": 5, "High (P90)": 15, projection_source: "ScoreSense" }));
window.__portfolioFixture = { builds: [], imports: [], requests: [], failSave: false, failLedger: false,
  accessStatus: 200, accessChecks: 0, saveAttempts: 0, delaySave: false, repeatBuild: false, run: 0,
  poolRequests: 0, poolVersion: 0, failPool: false, failSalaryImport: false,
  delayOptimize: false, ignoreOptimizeAbort: false, optimizeAborts: 0, failOptimize: false, partialCount: null, allAlternateRb: false,
  evidenceRequests: 0, comparisonRequests: [], failEvidence: false, missingEvidence: false,
  delayEvidence: false, ignoreEvidenceAbort: false, evidenceAborts: 0,
  failComparison: false, delayComparison: false, ignoreComparisonAbort: false, comparisonAborts: 0, mismatchComparison: false,
  sharedPreviewRequests: [], sharedEvaluateRequests: [], failSharedPreview: false, failSharedEvaluate: false,
  delaySharedPreview: false, ignoreSharedPreviewAbort: false, sharedPreviewAborts: 0,
  delaySharedEvaluate: false, ignoreSharedEvaluateAbort: false, sharedEvaluateAborts: 0,
  mismatchSharedPreview: false, mismatchSharedEvaluate: false,
  sharedAccessStatus: 200,
  contestPreviewRequests: [], contestEvaluateRequests: [], failContestPreview: false, failContestEvaluate: false,
  delayContestEvaluate: false, ignoreContestEvaluateAbort: false, contestEvaluateAborts: 0, mismatchContestEvaluate: false,
  publishDataRevision };
const fixturePool = state => players.map((player, index) => ({ ...player,
  ...((workflow || evidenceMode) && state.poolVersion && index === 0 ? {
    "Projected Points": player["Projected Points"] + state.poolVersion * 2,
    "Low (P10)": player["Low (P10)"] + state.poolVersion, "High (P90)": player["High (P90)"] + state.poolVersion * 3,
  } : {}) }));
const nativeFetch = window.fetch.bind(window);
const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right))) : item);
const byPlayerId = rows => [...rows].sort((a, b) => a.player_id.localeCompare(b.player_id));
const matchesSharedInputs = body => canonical(body.context) === canonical(sharedFixture.engine_inputs.context) &&
  canonical(byPlayerId(body.pool || [])) === canonical(byPlayerId(sharedFixture.engine_inputs.pool)) &&
  canonical(body.bank) === canonical(sharedFixture.engine_inputs.bank);
window.fetch = async (url, options = {}) => {
  if (!String(url).startsWith("/api/")) return nativeFetch(url, options);
  const path = String(url), state = window.__portfolioFixture;
  const body = typeof options.body === "string" ? JSON.parse(options.body) : {};
  const respond = (data, status = 200) => Response.json(data, { status });
  const delay = async (key, ignoreKey, abortedKey) => {
    if (!state[key]) return;
    await new Promise((resolve, reject) => {
      let abort;
      const release = `release${key.replace(/^delay/, "")}`;
      state[release] = () => { options.signal?.removeEventListener("abort", abort); resolve(); };
      if (!state[ignoreKey]) {
        abort = () => { state[abortedKey]++; reject(new DOMException("Synthetic request cancelled", "AbortError")); };
        if (options.signal?.aborted) abort();
        else options.signal?.addEventListener("abort", abort, { once: true });
      }
    });
  };
  if (path.includes("/formats")) return respond({ formats: DEFAULT_FORMATS });
  if (path.includes("/slates?")) return respond({ slates: [{ slate_id: "classic-fixture", name: "Classic fixture slate" }] });
  if (sharedMode && path.includes("/contest-research/")) {
    const evaluation = path.endsWith("/evaluate");
    (evaluation ? state.contestEvaluateRequests : state.contestPreviewRequests).push(body);
    if (state.sharedAccessStatus !== 200) return respond({ detail: "Synthetic research account access denied." }, state.sharedAccessStatus);
    if (evaluation) await delay("delayContestEvaluate", "ignoreContestEvaluateAbort", "contestEvaluateAborts");
    if (state[evaluation ? "failContestEvaluate" : "failContestPreview"]) return respond({ detail: "Synthetic contest research failure. Last review retained." }, 503);
    if (!matchesSharedInputs(body) || canonical(body.contest_field) !== canonical(contestFixture.file.contest_field) ||
        canonical(body.payout_contract) !== canonical(contestFixture.file.payout_contract)) return respond({ detail: "Request differs from exact real-engine synthetic contest input." }, 400);
    if (!evaluation) return respond(contestFixture.summary);
    const expected = sharedFixture.engine_inputs.lineups;
    if (body.seed !== 0 || body.draw_count !== 128 || body.top_k !== 10 || body.bank_id !== sharedFixture.summary.content_id ||
        body.contest_research_id !== contestFixture.summary.content_id || body.lineups?.length !== expected.length ||
        body.lineups.some((row, i) => canonical([...row.player_ids].sort()) !== canonical([...expected[i].player_ids].sort())))
      return respond({ detail: "Request differs from exact real-engine synthetic contest evaluation." }, 400);
    return respond({ ...(body.lineups[0]?.lineup_id?.startsWith("collection:") ? contestFixture.collection_evaluation : contestFixture.evaluation),
      input_snapshot_id: state.mismatchContestEvaluate ? "wrong-synthetic-input" : body.input_snapshot_id });
  }
  if (sharedMode && path.endsWith("/shared-outcomes/preview")) {
    state.sharedPreviewRequests.push(body);
    if (state.sharedAccessStatus !== 200) return respond({ detail: "Synthetic research account access denied." }, state.sharedAccessStatus);
    await delay("delaySharedPreview", "ignoreSharedPreviewAbort", "sharedPreviewAborts");
    if (state.failSharedPreview) return respond({ detail: "Synthetic scenario preview failure. Existing work is retained." }, 503);
    if (!matchesSharedInputs(body)) return respond({ detail: "This exact request differs from the real-engine synthetic input. No invented preview is returned." }, 400);
    return respond({ ...sharedFixture.summary,
      ...(state.mismatchSharedPreview ? { context: { ...sharedFixture.summary.context, slate_id: "wrong-synthetic-slate" } } : {}) });
  }
  if (sharedMode && path.endsWith("/shared-outcomes/evaluate")) {
    state.sharedEvaluateRequests.push(body);
    if (state.sharedAccessStatus !== 200) return respond({ detail: "Synthetic research account access denied." }, state.sharedAccessStatus);
    await delay("delaySharedEvaluate", "ignoreSharedEvaluateAbort", "sharedEvaluateAborts");
    if (state.failSharedEvaluate) return respond({ detail: "Synthetic scenario evaluation failure. Existing work is retained." }, 503);
    const expected = sharedFixture.engine_inputs.lineups;
    const exactRosters = body.lineups?.length === expected.length && body.lineups.every((row, index) =>
      canonical([...row.player_ids].sort()) === canonical([...expected[index].player_ids].sort()));
    if (!matchesSharedInputs(body) || !exactRosters || body.bank_id !== sharedFixture.summary.content_id || body.seed !== 0 || body.draw_count !== 256)
      return respond({ detail: "This exact request differs from the real-engine synthetic evaluation. No invented scores are returned." }, 400);
    return respond({ ...(body.lineups[0]?.lineup_id?.startsWith("collection:") ? sharedFixture.collection_evaluation : sharedFixture.evaluation),
      input_snapshot_id: state.mismatchSharedEvaluate ? "wrong-synthetic-input" : body.input_snapshot_id,
      bank_id: body.bank_id });
  }
  if (sharedMode && path.includes("/evidence?")) {
    const query = new URL(path, location.origin).searchParams;
    return respond({ status: "unavailable", reason: "No opportunity artifact is included in this isolated shared-scenario fixture.",
      context: { site: query.get("site"), sport: "NFL", season: Number(query.get("season")), week: Number(query.get("week")), slate_id: query.get("slate_id"), format: "classic" } });
  }
  if (evidenceMode && path.includes("/evidence?")) {
    state.evidenceRequests++;
    await delay("delayEvidence", "ignoreEvidenceAbort", "evidenceAborts");
    if (state.failEvidence) return respond({ detail: "Synthetic evidence artifact could not be read. Last reviewed inputs are retained." }, 503);
    const query = new URL(path, location.origin).searchParams;
    if (state.missingEvidence || query.get("site") !== "draftkings" || query.get("week") !== "5" || query.get("slate_id") !== "classic-fixture")
      return respond({ status: "unavailable", reason: "No synthetic evidence artifact for this exact slate and week.", context: { ...evidenceFixture.context, week: Number(query.get("week")), site: query.get("site"), slate_id: query.get("slate_id") } });
    return respond(evidenceFixture.evidence);
  }
  if (evidenceMode && path.endsWith("/compare-classic")) {
    state.comparisonRequests.push(body);
    await delay("delayComparison", "ignoreComparisonAbort", "comparisonAborts");
    if (state.failComparison) return respond({ detail: "Synthetic comparison failure. Current lineups are unchanged." }, 503);
    return respond({ ...evidenceFixture.comparison, input_snapshot_id: state.mismatchComparison ? "wrong-synthetic-input" : body.input_snapshot_id, evidence_id: body.evidence_id });
  }
  if (workflow && path.includes("/salaries/import")) {
    if (state.failSalaryImport) return respond({ detail: "Synthetic invalid salary file: required columns are missing." }, 400);
    return respond({ players: fixturePool(state), salaries: fixturePool(state).map(p => ({ dfs_id: p.dfs_id,
      player_name: p.Player, position: p.Position, team: p.Team, salary: p.salary })),
      salary_snapshot: { id: "b".repeat(64) }, slate: { name: "Synthetic imported slate" }, meta: {} });
  }
  if (path.includes("/salaries/load") || (guardrails && path.includes("/pool?"))) {
    state.poolRequests++;
    if (workflow && state.failPool) return respond({ detail: "Synthetic player-pool refresh failed; no new values were received." }, 503);
    const currentPool = fixturePool(state);
    const catalog = state.unrelatedCatalog ? currentPool.map(p => ({ ...p, dfs_id: String(Number(p.dfs_id) + 10000), salary: 4500 })) : currentPool;
    return respond({ players: catalog, salaries: catalog.map(p => ({ dfs_id: p.dfs_id,
      player_name: p.Player, position: p.Position, team: p.Team, salary: p.salary })), salary_snapshot: { id: (state.unrelatedCatalog ? "c" : "b").repeat(64) },
      slate: { name: "Classic fixture slate" }, meta: {} });
  }
  if (path.includes("/vegas")) return respond({ games: sharedMode ? sharedFixture.engine_inputs.bank.games.map(game => ({ game_id: game.game_id,
    home: game.home_team, away: game.away_team, kickoff_et: game.kickoff_at, kickoff_at: game.kickoff_at,
    weekday: "Synthetic fixture", total_line: 47, spread_line: -3, home_implied: 25, away_implied: 22 })) : evidenceMode ? evidenceFixture.evidence.games.map((game, index) => ({ ...game,
    kickoff_et: game.kickoff_at, weekday: "Synthetic fixture", total_line: [47, 43, 40][index], spread_line: [3, -2, 1][index],
    home_implied: [25, 20.5, 20.5][index], away_implied: [22, 22.5, 19.5][index],
    first_seen_total_line: [48, null, 40][index], first_seen_spread_line: [3, null, 1][index],
    line_first_seen_at: "2026-10-06T01:00:00Z" })) : guardrails ? [{ game_id: "synthetic-kc-buf", home: "KC", away: "BUF",
    kickoff_et: "2099-10-11T20:25:00Z", weekday: "Synthetic fixture", total_line: 47, spread_line: -3, home_implied: 25, away_implied: 22 }] : [] });
  if (path.endsWith("/export-access")) {
    state.accessChecks++;
    return respond(state.accessStatus === 200 ? { allowed: true } : { detail: "Fixture account access denied" }, state.accessStatus);
  }
  if (path.endsWith("/optimize")) {
    state.requests.push(body);
    if (workflow && state.delayOptimize) await new Promise((resolve, reject) => {
      let abort;
      state.releaseOptimize = () => { options.signal?.removeEventListener("abort", abort); resolve(); };
      if (!state.ignoreOptimizeAbort) {
        abort = () => { state.optimizeAborts++; reject(new DOMException("Synthetic build cancelled", "AbortError")); };
        if (options.signal?.aborted) abort();
        else options.signal?.addEventListener("abort", abort, { once: true });
      }
    });
    if (workflow && state.failOptimize) return respond({ ok: false, error: "Synthetic build failure; the prior reviewed build is still available." });
    if (body.include_captain_comparison) return respond({ ok: true,
      captain_comparison: { snapshot_id: "synthetic-comparison", complete: false, candidates: [],
        eligible_captains: 0, evaluated_captains: 0, objective: body.objective },
      build_snapshot: { id: "synthetic-comparison", captured_at: "2026-10-10T12:00:00Z" } });
    if (sharedMode) {
      const lineups = sharedFixture.built_lineups.slice(0, body.lineup_count);
      return respond({ ok: true, lineups, complete: lineups.length === body.lineup_count,
        build_snapshot: { id: "synthetic-shared-build", captured_at: sharedFixture.engine_inputs.bank.decision_at,
          content: { schema_version: "dfs_build_inputs_v1", parameters: body, input_pool: fixturePool(state) } } });
    }
    if (evidenceMode) {
      const report = evidenceFixture.comparison;
      const selected = report.candidates.filter(candidate => candidate.in_primary_scope && candidate.completions[0]?.result?.validation?.ok)
        .flatMap(candidate => candidate.completions.map(completion => completion.result));
      const unique = [...new Map(selected.map(entry => [entry.lineup.map(player => player.player_id).sort().join("|"), entry])).values()];
      // Normal multi-build validation belongs to the top-level response. The
      // comparison helper separately validates every completion result.
      const lineups = unique.slice(0, body.lineup_count).map(({ validation, ...entry }) => entry);
      return respond({ ok: true, lineups, complete: lineups.length === body.lineup_count,
        build_snapshot: { id: "synthetic-evidence-build", captured_at: evidenceFixture.evidence.decision_at,
          content: { schema_version: "dfs_build_inputs_v1", parameters: body, input_pool: fixturePool(state) } } });
    }
    const run = state.repeatBuild ? 0 : state.run++;
    const currentPool = fixturePool(state);
    const selectedCount = workflow && state.partialCount != null ? state.partialCount : body.lineup_count;
    const lineups = Array.from({ length: selectedCount }, (_, index) => ({ total_salary: 36000, total_points: 90 + (workflow ? state.poolVersion * 2 : 0),
      lineup: slots.map((slot, i) => {
        // Explicit three-lineup structural fixture: the original RB pair occurs
        // twice, then a separately declared receiving RB replaces one member.
        // This is a UI/independent-validation fixture, never a real solver claim.
        const p = currentPool[guardrails && i === 2 && (index % 3 === 2 || (workflow && state.allAlternateRb)) ? 178 : i === 5 ? 9 + run * 50 + index : i];
        return { slot, player_id: p.player_id, dfs_id: p.dfs_id, player: p.Player, position: p.Position, team: p.Team,
          salary: p.salary, proj: body.projection_overrides[p.player_id]?.proj ?? p["Projected Points"], floor: p["Low (P10)"], ceiling: p["High (P90)"] };
      }),
    }));
    if (workflow) lineups.forEach(entry => { entry.total_points = entry.lineup.reduce((sum, player) => sum + player.proj, 0); });
    return respond({ ok: true, lineups,
      ...(body.portfolio_mode === "global" ? { portfolio_selection: {
        requested_count: body.lineup_count, selected_count: lineups.length, unique_count: lineups.length,
        candidate_count: lineups.length, solver_status: workflow ? "synthetic workflow fixture response" : guardrails ? "synthetic guardrail fixture response" : "fixture response", conflicts: [],
      } } : {}),
      build_snapshot: { id: `snapshot-${run}`, captured_at: "2026-10-10T12:00:00Z",
      content: { schema_version: "dfs_build_inputs_v1", parameters: body, input_pool: currentPool } } });
  }
  if (path.startsWith("/api/lineup/results") && !path.endsWith("/import")) {
    state.accessChecks++;
    return respond({ entries: [], total: 0 }, state.accessStatus);
  }
  if (path.endsWith("/builds") && options.method === "POST") {
    state.saveAttempts++;
    if (state.delaySave) await new Promise(resolve => { state.releaseSave = resolve; });
    if (state.failSave) return respond({ detail: "Fixture save failure" }, 503);
    const saved = { ...body, id: `saved-${state.builds.length + 1}` };
    state.builds.push(saved); return respond(saved);
  }
  if (path.endsWith("/results/import")) {
    if (state.failLedger) return respond({ detail: "Fixture ledger failure" }, 503);
    state.imports.push(body); return respond({ imported: body.entries.length });
  }
  return respond({});
};
const meta = { default_season: 2026, default_week: 5, seasons: [2026], weeks_by_season: { 2026: guardrails ? [5, 6] : [5] } };
function PopulatedAudit() {
  const b = useDfsBuilder(meta), stage = useRef(0);
  useEffect(() => {
    if (stage.current === 0 && b.pool.length && !b.busy) { stage.current = 1; b.run(); }
    if (stage.current === 1 && b.currentBuild && !b.building) { stage.current = 2; b.addPortfolioBatch("Audit sample batch"); }
  }, [b.pool, b.busy, b.currentBuild, b.building]);
  return <div className="dfw"><DfsWorkspace b={b} /></div>;
}
createRoot(document.getElementById("root")).render(<div className="app"><main id="main-content">{location.search.includes("audit") ? <PopulatedAudit /> : <LineupOptimizer projMeta={meta} />}</main></div>);
