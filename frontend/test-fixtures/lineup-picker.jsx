// Production lineup components with isolated, deterministic writes; never contacts a league.
import React from "react";
import { createRoot } from "react-dom/client";
import WeeklyCommandCenter from "../src/DraftHub/WeeklyCommandCenter";
import "../src/styles.css";
import "../src/styles/fantasy.css";
import "../src/styles/product-hierarchy.css";
import "../src/styles/product-rhythm.css";
import "../src/styles/fantasy-phone.css";

const params = new URLSearchParams(location.search);
const state = params.get("state") || "ready";
const player = (id, name, position, team, p50, slot = "BN") => ({
  player_id: id, player_name: name, position, team, p50, slot,
  kickoff_et: "2030-09-22T13:00:00-04:00", p10: 6, p90: 28,
});
const rules = { roster: { qb: { starter: 1 }, rb: { starter: 1 }, wr: { starter: 1 }, te: { starter: 0 },
  k: { starter: 0 }, def: { starter: 0 }, flex: { starter: 1, eligible: ["RB", "WR", "TE"] } } };
const context = { mode: "league", league_id: "fixture", team_id: "mine", team_name: "Sunday Roster",
  draft_completed: true, rules, ...(state === "linked" ? { sleeper_league_id: "fixture" } : {}) };
const data = {
  hub_context: context,
  meta: { season: 2026, week: 2, lineup_source: state === "linked" ? "sleeper" : "hub", lineup_locked: state === "readonly", week_scored: state === "readonly", projections_built_at: new Date().toISOString() },
  status: {}, sync: {}, counts: { roster: 7, missing_projections: 0 }, decisions: [],
  roster: { starters: [player("hurts", "Jalen Hurts", "QB", "PHI", 22.4, "QB"),
    player("bijan", "Bijan Robinson", "RB", "ATL", 19.8, "RB"),
    player("lamb", "CeeDee Lamb", "WR", "DAL", 21.2, "WR"),
    player("waddle", "Jaylen Waddle", "WR", "MIA", 12.6, "FLEX")],
    bench: [player("smith", "DeVonta Smith", "WR", "PHI", 15.1),
      player("charbonnet", "Zach Charbonnet", "RB", "SEA", 10.4),
      player("daniels", "Jayden Daniels", "QB", "WAS", 21.5)] },
};
if (state === "empty") data.roster.starters = data.roster.starters.filter((p) => p.slot !== "FLEX");
if (state === "no-options") data.roster.bench = [data.roster.bench[2]];
if (state === "locked-player") data.roster.bench[0].locked = true;
if (state === "locked-starter") data.roster.starters[3].locked = true;
if (state === "missing") data.roster.bench[0].p50 = null;
window.fixtureWrites = [];
window.fetch = async (input, options = {}) => {
  const path = String(input);
  if (path.includes("/lineup")) {
    window.fixtureWrites.push({ path, method: options.method, body: JSON.parse(options.body) });
    if (state === "write-error") return Response.json({ detail: "Game started. This player is locked." }, { status: 409 });
    await new Promise((resolve) => setTimeout(resolve, 150));
    const payload = JSON.parse(options.body);
    if (path.endsWith("/swap")) {
      const incoming = data.roster.bench.find((p) => p.player_id === payload.bench_player_id);
      const outgoing = data.roster.starters.find((p) => p.player_id === payload.starter_player_id);
      data.roster.starters = data.roster.starters.map((p) => p === outgoing ? { ...incoming, slot: outgoing.slot } : p);
      data.roster.bench = data.roster.bench.map((p) => p === incoming ? { ...outgoing, slot: "BN" } : p);
    } else {
      const pool = [...data.roster.starters, ...data.roster.bench];
      data.roster.starters = payload.starters.map((s) => ({ ...pool.find((p) => p.player_id === s.player_id), slot: s.slot }));
      data.roster.bench = pool.filter((p) => !payload.starters.some((s) => s.player_id === p.player_id));
    }
    return Response.json({ saved: true });
  }
  if (path.startsWith("/api/hub/week")) {
    if (state === "loading") await new Promise(() => {});
    if (state === "load-error") return Response.json({ detail: "Unavailable" }, { status: 503 });
    return Response.json(data);
  }
  if (path.includes("/vibe-aura")) return Response.json({ aura_by_player_id: {} });
  return Response.json({ media: Object.fromEntries([
    ["hurts", 4040715], ["bijan", 4430809], ["lamb", 4241389], ["waddle", 4372016],
    ["smith", 4241478], ["charbonnet", 4426385], ["daniels", 4426348],
  ].map(([id, espn]) => [id, { headshot_url: `https://a.espncdn.com/i/headshots/nfl/players/full/${espn}.png` }])) });
};
createRoot(document.getElementById("root")).render(<div className="app"><main id="main-content">
  <div className="draft-hub"><WeeklyCommandCenter hubContext={context} onNavigate={(view) => {
    window.fixtureDestination = view;
  }} /></div></main></div>);
