// Production builder/workspace with deterministic, local-only API responses.
import React, { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import LineupOptimizer from "../src/LineupOptimizer.jsx";
import useDfsBuilder from "../src/useDfsBuilder.js";
import DfsWorkspace from "../src/DfsWorkspace.jsx";
import { DEFAULT_FORMATS } from "../src/dfsToolPresentation.js";
import { publishDataRevision } from "../src/useDataRevision.js";
import "../src/styles.css";
import "../src/styles/color-theme.css";
import "../src/styles/product-hierarchy.css";
import "../src/styles/product-rhythm.css";
import "../src/styles/fantasy-phone.css";

const positions = ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "WR", "DST"];
const slots = ["QB", "RB1", "RB2", "WR1", "WR2", "WR3", "TE", "FLEX", "DST"];
const largePool = new URLSearchParams(location.search).has("large-pool");
const workflow = new URLSearchParams(location.search).has("workflow");
const guardrails = workflow || new URLSearchParams(location.search).has("guardrails");
const historicalFeatures = largePool
  ? Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`model_feature_${i}`, i / 100]))
  : {};
const players = Array.from({ length: largePool ? 700 : workflow ? 400 : 180 }, (_, i) => ({ ...historicalFeatures, player_id: `p${i + 1}`, dfs_id: String(i + 1),
  Player: `Example ${i + 1}`, Team: guardrails && i >= 9 ? "KC" : i % 2 ? "BUF" : "KC",
  Opponent: guardrails && i >= 9 ? "BUF" : i % 2 ? "KC" : "BUF",
  Position: guardrails && i === 178 ? "RB" : positions[i] || "WR", salary: 4000,
  "Projected Points": 10, "Low (P10)": 5, "High (P90)": 15, projection_source: "ScoreSense" }));
window.__portfolioFixture = { builds: [], imports: [], requests: [], failSave: false, failLedger: false,
  accessStatus: 200, accessChecks: 0, saveAttempts: 0, delaySave: false, repeatBuild: false, run: 0,
  poolRequests: 0, poolVersion: 0, failPool: false, failSalaryImport: false,
  delayOptimize: false, ignoreOptimizeAbort: false, optimizeAborts: 0, failOptimize: false, partialCount: null, allAlternateRb: false,
  publishDataRevision };
const fixturePool = state => players.map((player, index) => ({ ...player,
  ...(workflow && state.poolVersion && index === 0 ? {
    "Projected Points": 10 + state.poolVersion * 2,
    "Low (P10)": 5 + state.poolVersion, "High (P90)": 15 + state.poolVersion * 3,
  } : {}) }));
const nativeFetch = window.fetch.bind(window);
window.fetch = async (url, options = {}) => {
  if (!String(url).startsWith("/api/")) return nativeFetch(url, options);
  const path = String(url), state = window.__portfolioFixture;
  const body = typeof options.body === "string" ? JSON.parse(options.body) : {};
  const respond = (data, status = 200) => Response.json(data, { status });
  if (path.includes("/formats")) return respond({ formats: DEFAULT_FORMATS });
  if (path.includes("/slates?")) return respond({ slates: [{ slate_id: "classic-fixture", name: "Classic fixture slate" }] });
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
  if (path.includes("/vegas")) return respond({ games: guardrails ? [{ game_id: "synthetic-kc-buf", home: "KC", away: "BUF",
    kickoff_et: "2099-10-11T20:25:00Z", weekday: "Synthetic fixture", total: 47, spread_home: -3, home_implied: 25, away_implied: 22 }] : [] });
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
