// Real product components, isolated deterministic data. No contest/account requests.
import React from "react";
import { createRoot } from "react-dom/client";
import LineupOptimizer from "../src/LineupOptimizer.jsx";
import DesktopPrimaryHeader from "../src/layout/DesktopPrimaryHeader";
import ProductSubnav from "../src/layout/ProductSubnav";
import { APP_SECTIONS } from "../src/appNavigation";
import { DEFAULT_FORMATS } from "../src/dfsToolPresentation";
import "../src/styles.css";
import "../src/styles/color-theme.css";
import "../src/styles/product-hierarchy.css";
import "../src/styles/product-rhythm.css";
import "../src/styles/fantasy-phone.css";
import "../src/styles/fantasy-header.css";

const names = [
  ["Puka Nacua", "LAR", "WR", 11200, 21],
  ["Christian McCaffrey", "SF", "RB", 10600, 20.9],
  ["Matthew Stafford", "LAR", "QB", 9800, 18.2],
  ["Brock Purdy", "SF", "QB", 9400, 18.6],
  ["Mike Evans", "SF", "WR", 8200, 11.9],
  ["Blake Corum", "LAR", "RB", 4600, 8.7],
  ["Eddy Pineiro", "SF", "K", 4800, 8],
  ["Colby Parkinson", "LAR", "TE", 3600, 5.5],
];
const pool = names.map(([Player, Team, Position, salary, proj], i) => ({
  player_id: `p${i}`,
  Player,
  Team,
  Position,
  salary,
  dfs_id: String(200 + i),
  cpt_dfs_id: String(100 + i),
  cpt_salary: salary * 1.5,
  "Projected Points": proj,
  "Low (P10)": proj * 0.5,
  "High (P90)": proj * 1.6,
  projection_source: Position === "K" ? "Historical estimate" : i === 7 ? "Roster estimate" : "ScoreSense",
}));
let entries = Array.from({ length: 120 }, (_, i) => ({
  site: "draftkings",
  entry_id: String(1000 + i),
  contest_id: String(10 + Math.floor(i / 20)),
  contest_name: `Example slate ${1 + Math.floor(i / 20)}`,
  date: `2026-09-0${1 + Math.floor(i / 20)}`,
  fee_cents: 500,
  payout_cents:
    i % 20 === 0 ? [4000, 18000, 0, 6000, 35000, 8000][Math.floor(i / 20)] : 0,
  status: "settled",
  points: 80 + (i % 20),
  rank: 100 + i,
  lineup_text: `CPT ${i % 2 ? "Blake Corum" : "Puka Nacua"} FLEX Example player`,
}));
let builds = [];
const mode = new URLSearchParams(location.search).get("state");
if (mode === "empty") entries = [];
function fixturePlayers(site) {
  const single = /showdown|fanduel_single/.test(site || "");
  return [
            ...pool.map(p => ({ ...p, "Projected Points": p["Projected Points"] + (window.__dfsProjectionBump || 0) })),
            ...(mode === "coverage" ? [
              { player_id: "dst-la", Player: "Rams", Team: "LAR", Position: "DST", salary: 2900, "Projected Points": 7.2, "Low (P10)": 0.5, "High (P90)": 15, projection_source: "ScoreSense" },
              { player_id: "missing", dfs_id: "300", Player: "Missing Player", Team: "NYJ", Position: "TE", salary: 1500, "Projected Points": null, "Low (P10)": null, "High (P90)": null, projection_source: "Missing projection", projection_missing_reason: "position_conflict" },
              { player_id: "out", Player: "Unavailable Player", Team: "LAR", Position: "WR", salary: 3000, "Projected Points": 4, "Low (P10)": 1, "High (P90)": 8, "Injury Status": "IR", projection_source: "ScoreSense" },
              { player_id: "bye", Player: "Bye Player", Team: "BUF", Position: "QB", salary: 6000, "Projected Points": 15, "Low (P10)": 5, "High (P90)": 25, on_bye: true, projection_source: "ScoreSense" },
              { player_id: "mia", Player: "Dolphins Receiver", Team: "MIA", Position: "WR", salary: 5000, "Projected Points": 10, "Low (P10)": 3, "High (P90)": 18, projection_source: "ScoreSense" },
              { player_id: "kc", Player: "Chiefs Receiver", Team: "KC", Position: "WR", salary: 5000, "Projected Points": 10, "Low (P10)": 3, "High (P90)": 18, projection_source: "ScoreSense" },
            ] : []),
          ].map((p, i) => {
    const salary = mode === "coverage" && !single ? Math.round(p.salary * 0.7 / 100) * 100 : p.salary;
    return { dfs_id: String(400 + i), cpt_dfs_id: String(1400 + i), ...p, salary, cpt_salary: salary * 1.5 };
  });
}
const nativeFetch = window.fetch.bind(window);
window.fetch = async (url, options = {}) => {
  if (!String(url).startsWith("/api/")) return nativeFetch(url, options);
  const u = String(url),
    body =
      options.body && typeof options.body === "string"
        ? JSON.parse(options.body)
        : {};
  const respond = (data, status = 200) =>
    Promise.resolve(
      new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    );
  if (u.includes("/formats")) return respond({ formats: DEFAULT_FORMATS });
  if (u.includes("/slates?"))
    return respond({
      slates: [{ slate_id: "preview", name: mode === "coverage" && !/showdown|fanduel_single/.test(u) ? "Sunday main · sample slate" : "SF at LAR · sample slate" }],
    });
  if (mode === "loading" && (u.includes("/salaries/") || u.includes("/pool?"))) await new Promise(resolve => setTimeout(resolve, 1200));
  if (u.includes("/salaries/") || u.includes("/pool?"))
    return (mode === "error" || window.__dfsRefreshFail)
      ? respond(
          {
            detail: "Sample salary service failure. Import a CSV to continue.",
          },
          503,
        )
      : respond({
          players: mode === "empty" ? [] : fixturePlayers(new URL(u, location.origin).searchParams.get("site")),
          salaries: fixturePlayers(new URL(u, location.origin).searchParams.get("site")).map(p => ({
            dfs_id: p.dfs_id, cpt_dfs_id: p.cpt_dfs_id, salary: p.salary, cpt_salary: p.cpt_salary,
            player_name: p.Player, team: p.Team, position: p.Position,
          })),
          salary_snapshot: { id: (u.includes("draftkings_showdown") ? "a" : "b").repeat(64) },
          slate: { name: mode === "coverage" && !/showdown|fanduel_single/.test(u) ? "Sunday main · sample slate" : "SF at LAR · sample slate" },
          stats: { matched: 8, slate_players: 8 },
          meta: { refresh: { status: window.__dfsServerStale ? "error" : "ok", stale: Boolean(window.__dfsServerStale), last_success_at: new Date(Date.now() - 60000).toISOString(), refresh_interval_seconds: 300, season: 2026, week: 1 } },
        });
  if (u.includes("/vegas?")) return respond({ games: [
    { game_id: "sf-la", away: "SF", home: "LAR", total_line: 49.5, spread_line: 2.5, away_implied: 23.5, home_implied: 26, first_seen_total_line: 47.5, first_seen_spread_line: 1.5, weekday: "Sunday", kickoff_et: "2026-09-27T16:25:00-04:00" },
    { game_id: "buf-kc", away: "BUF", home: "KC", total_line: 48, spread_line: -1, away_implied: 24.5, home_implied: 23.5, first_seen_total_line: 49, first_seen_spread_line: 1, weekday: "Sunday", kickoff_et: "2026-09-27T16:25:00-04:00" },
    { game_id: "nyj-mia", away: "NYJ", home: "MIA", total_line: 41.5, spread_line: 3.5, away_implied: 19, home_implied: 22.5, first_seen_total_line: null, first_seen_spread_line: null, weekday: "Sunday", kickoff_et: "2026-09-27T13:00:00-04:00" },
  ] });
  if (u.endsWith("/optimize")) {
    window.__lastDfsRequest = body;
    let rows = [5, 0, 3, 1, 4, 7].map((idx, i) => {
      const p = pool[idx],
        mult = i === 0 ? 1.5 : 1;
      return {
        slot: i === 0 ? "CPT" : `FLEX${i}`,
        player_id: p.player_id,
        player: p.Player,
        team: p.Team,
        position: p.Position,
        dfs_id: i === 0 ? p.cpt_dfs_id : p.dfs_id,
        salary: p.salary * mult,
        proj: p["Projected Points"] * mult,
        floor: p["Low (P10)"] * mult,
        ceiling: p["High (P90)"] * mult,
      };
    });
    if (mode === "coverage" && !/showdown|fanduel_single/.test(body.site)) {
      const players = fixturePlayers(body.site);
      const slots = body.site === "seasonal"
        ? [["QB", "p2"], ["RB1", "p1"], ["RB2", "p5"], ["WR1", "p0"], ["WR2", "p4"], ["TE", "p7"], ["FLEX", "mia"]]
        : [["QB", "p2"], ["RB1", "p1"], ["RB2", "p5"], ["WR1", "p0"], ["WR2", "p4"], ["WR3", "mia"], ["TE", "p7"], ["FLEX", "kc"], ["DST", "dst-la"]];
      rows = slots.map(([slot, id]) => {
        const p = players.find(player => player.player_id === id);
        return { slot, player_id: id, player: p.Player, team: p.Team, position: p.Position, dfs_id: p.dfs_id,
          salary: p.salary, proj: p["Projected Points"], floor: p["Low (P10)"], ceiling: p["High (P90)"] };
      });
    }
    if (body.include_captain_comparison) {
      if (window.__comparisonMode === "readonly") return respond({ detail: "Sign in to compare Captains." }, 401);
      if (window.__comparisonMode === "error") return respond({ detail: "Comparison service unavailable." }, 503);
      if (window.__comparisonMode === "slow") await new Promise(resolve => { window.__releaseComparison = resolve; });
      const partial = window.__comparisonMode === "partial";
      const none = window.__comparisonMode === "none";
      return respond({
        ok: true,
        build_snapshot: { id: "comparison-fixture", captured_at: "2026-09-28T12:00:00Z" },
        captain_comparison: {
          snapshot_id: window.__comparisonMode === "mismatch" ? "wrong" : "comparison-fixture",
          objective: body.objective, complete: !partial, eligible_captains: 2, evaluated_captains: partial ? 1 : 2,
          candidates: [
            { captain_id: "p5", captain_name: "Blake Corum", status: none ? "infeasible" : "optimal", objective_score: 90.95, gap_from_best_evaluated: 0,
              result: { validation: { ok: true }, lineup: rows, total_salary: 49900 } },
            { captain_id: "p0", captain_name: "Puka Nacua", status: partial ? "not_evaluated" : "infeasible" },
          ],
        },
      });
    }
    return respond({
      ok: true,
      build_snapshot: { id: "fixture-snapshot", captured_at: "2026-09-28T12:00:00Z", content: { schema_version: "fixture" } },
      lineups: Array.from({ length: body.lineup_count }, () => ({
        lineup: rows,
        total_salary: rows.reduce((sum, p) => sum + p.salary, 0),
        total_points: rows.reduce((sum, p) => sum + p.proj, 0),
      })),
    });
  }
  if (u.endsWith("/builds")) {
    window.__lastDfsSavedBuild = body;
    const build = {
      ...body,
      id: `build-${builds.length + 1}`,
      saved_at: new Date().toISOString(),
    };
    builds.unshift(build);
    return respond(build);
  }
  if (u.endsWith("/results/import")) {
    for (const r of body.entries) {
      const i = entries.findIndex(
        (e) =>
          e.site === r.site &&
          e.contest_id === r.contest_id &&
          e.entry_id === r.entry_id,
      );
      if (i < 0) entries.push(r);
      else entries[i] = { ...entries[i], ...r };
    }
    return respond({ entries, builds });
  }
  if (u.endsWith("/results/remove")) {
    entries = entries.filter(
      (e) =>
        !body.entries.some(
          (r) =>
            r.site === e.site &&
            r.contest_id === e.contest_id &&
            r.entry_id === e.entry_id,
        ),
    );
    return respond({ entries, builds });
  }
  if (u.endsWith("/results"))
    return mode === "readonly"
      ? respond({ detail: "Sign in to save your DFS results." }, 401)
      : respond({ entries, builds });
  return respond({});
};
createRoot(document.getElementById("root")).render(
  <div className="app">
    <a className="app-skip-link" href="#main-content">
      Skip to content
    </a>
    <p
      style={{
        padding: "var(--space-3)",
        margin: 0,
        fontSize: 12,
        color: "var(--text-secondary)",
      }}
    >
      Interactive design preview · illustrative data · no real entries or
      account changes
    </p>
    <header className="app-header app-header--product">
      <div className="app-header-shell">
        <DesktopPrimaryHeader
          productName="ScoreSense"
          studioName="4th Down Labs"
          sections={APP_SECTIONS}
          view="tools"
          pathForSection={() => "#"}
          onNavigate={() => {}}
        >
          <span>Sample account</span>
        </DesktopPrimaryHeader>
        <ProductSubnav view="tools" active="dfs" onNavigate={() => {}} />
      </div>
    </header>
    <main id="main-content" className="app-main" tabIndex={-1}>
      <LineupOptimizer
        projMeta={{
          default_season: 2026,
          default_week: 1,
          seasons: [2026],
          weeks_by_season: { 2026: [1, 2] },
        }}
      />
    </main>
  </div>,
);