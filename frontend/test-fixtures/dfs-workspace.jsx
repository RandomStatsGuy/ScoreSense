// Real product components, isolated deterministic data. No contest/account requests.
import React from "react";
import { createRoot } from "react-dom/client";
import LineupOptimizer from "../src/LineupOptimizer.jsx";
import DesktopPrimaryHeader from "../src/layout/DesktopPrimaryHeader";
import ProductSubnav from "../src/layout/ProductSubnav";
import { APP_SECTIONS } from "../src/appNavigation";
import { DEFAULT_FORMATS } from "../src/dfsToolPresentation";
import "../src/styles.css";
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
  projection_source: Position === "K" ? "Imported" : "ScoreSense",
}));
const salaries = pool.map((p) => ({
  dfs_id: p.dfs_id,
  cpt_dfs_id: p.cpt_dfs_id,
  salary: p.salary,
  cpt_salary: p.cpt_salary,
  player_name: p.Player,
  team: p.Team,
  position: p.Position,
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
      slates: [{ slate_id: "preview", name: "SF at LAR · sample slate" }],
    });
  if (mode === "loading" && (u.includes("/salaries/") || u.includes("/pool?"))) await new Promise(resolve => setTimeout(resolve, 1200));
  if (u.includes("/salaries/") || u.includes("/pool?"))
    return mode === "error"
      ? respond(
          {
            detail: "Sample salary service failure. Import a CSV to continue.",
          },
          503,
        )
      : respond({
          players: mode === "empty" ? [] : pool,
          salaries,
          slate: { name: "SF at LAR · sample slate" },
          stats: { matched: 8, slate_players: 8 },
        });
  if (u.endsWith("/optimize")) {
    window.__lastDfsRequest = body;
    const rows = [5, 0, 3, 1, 4, 7].map((idx, i) => {
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
    return respond({
      ok: true,
      lineups: Array.from({ length: body.lineup_count }, () => ({
        lineup: rows,
        total_salary: 49900,
        total_points: 90.95,
      })),
    });
  }
  if (u.endsWith("/builds")) {
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
