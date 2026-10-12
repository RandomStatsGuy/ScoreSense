// Production builder/workspace with deterministic, local-only API responses.
import React, { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import LineupOptimizer from "../src/LineupOptimizer.jsx";
import useDfsBuilder from "../src/useDfsBuilder.js";
import DfsWorkspace from "../src/DfsWorkspace.jsx";
import { DEFAULT_FORMATS } from "../src/dfsToolPresentation.js";
import "../src/styles.css";
import "../src/styles/color-theme.css";
import "../src/styles/product-hierarchy.css";
import "../src/styles/product-rhythm.css";
import "../src/styles/fantasy-phone.css";

const positions = ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "WR", "DST"];
const slots = ["QB", "RB1", "RB2", "WR1", "WR2", "WR3", "TE", "FLEX", "DST"];
const largePool = new URLSearchParams(location.search).has("large-pool");
const guardrails = new URLSearchParams(location.search).has("guardrails");
const historicalFeatures = largePool
  ? Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`model_feature_${i}`, i / 100]))
  : {};
const players = Array.from({ length: largePool ? 700 : 180 }, (_, i) => ({ ...historicalFeatures, player_id: `p${i + 1}`, dfs_id: String(i + 1),
  Player: `Example ${i + 1}`, Team: guardrails && i >= 9 ? "KC" : i % 2 ? "BUF" : "KC",
  Opponent: guardrails && i >= 9 ? "BUF" : i % 2 ? "KC" : "BUF",
  Position: guardrails && i === 178 ? "RB" : positions[i] || "WR", salary: 4000,
  "Projected Points": 10, "Low (P10)": 5, "High (P90)": 15, projection_source: "ScoreSense" }));
window.__portfolioFixture = { builds: [], imports: [], requests: [], failSave: false, failLedger: false,
  accessStatus: 200, accessChecks: 0, saveAttempts: 0, delaySave: false, repeatBuild: false, run: 0 };
const nativeFetch = window.fetch.bind(window);
window.fetch = async (url, options = {}) => {
  if (!String(url).startsWith("/api/")) return nativeFetch(url, options);
  const path = String(url), state = window.__portfolioFixture;
  const body = typeof options.body === "string" ? JSON.parse(options.body) : {};
  const respond = (data, status = 200) => Response.json(data, { status });
  if (path.includes("/formats")) return respond({ formats: DEFAULT_FORMATS });
  if (path.includes("/slates?")) return respond({ slates: [{ slate_id: "classic-fixture", name: "Classic fixture slate" }] });
  if (path.includes("/salaries/load") || (guardrails && path.includes("/pool?"))) {
    const catalog = state.unrelatedCatalog ? players.map(p => ({ ...p, dfs_id: String(Number(p.dfs_id) + 10000), salary: 4500 })) : players;
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
    if (body.include_captain_comparison) return respond({ ok: true,
      captain_comparison: { snapshot_id: "synthetic-comparison", complete: false, candidates: [],
        eligible_captains: 0, evaluated_captains: 0, objective: body.objective },
      build_snapshot: { id: "synthetic-comparison", captured_at: "2026-10-10T12:00:00Z" } });
    const run = state.repeatBuild ? 0 : state.run++;
    const lineups = Array.from({ length: body.lineup_count }, (_, index) => ({ total_salary: 36000, total_points: 90,
      lineup: slots.map((slot, i) => {
        // Explicit three-lineup structural fixture: the original RB pair occurs
        // twice, then a separately declared receiving RB replaces one member.
        // This is a UI/independent-validation fixture, never a real solver claim.
        const p = players[guardrails && i === 2 && index % 3 === 2 ? 178 : i === 5 ? 9 + run * 50 + index : i];
        return { slot, player_id: p.player_id, dfs_id: p.dfs_id, player: p.Player, position: p.Position, team: p.Team,
          salary: p.salary, proj: body.projection_overrides[p.player_id]?.proj ?? 10, floor: 5, ceiling: 15 };
      }),
    }));
    return respond({ ok: true, lineups,
      ...(body.portfolio_mode === "global" ? { portfolio_selection: {
        requested_count: body.lineup_count, selected_count: lineups.length, unique_count: lineups.length,
        candidate_count: lineups.length, solver_status: guardrails ? "synthetic guardrail fixture response" : "fixture response", conflicts: [],
      } } : {}),
      build_snapshot: { id: `snapshot-${run}`, captured_at: "2026-10-10T12:00:00Z",
      content: { schema_version: "dfs_build_inputs_v1", parameters: body, input_pool: players } } });
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
