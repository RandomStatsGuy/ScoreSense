// Isolated synthetic contract fixture: production provider, modal, and status copy.
import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { PlayerCardProvider, PlayerCardReadScope, usePlayerCard } from "../src/PlayerCardContext";
import "../src/styles.css";
import "../src/styles/projections-experience.css";
import "../src/styles/product-hierarchy.css";
import "../src/styles/product-rhythm.css";
import "../src/styles/fantasy-phone.css";
import "../src/styles/color-theme.css";

const query = new URLSearchParams(location.search);
const state = query.get("state") || "recovery";
document.documentElement.dataset.theme = query.get("theme") || "dark";
const candidates = [
  { playerId: "8137", name: "George Pickens", position: "wr", team: "DAL" },
  { playerId: "second", name: "Second Player", position: "te" },
];
const calls = [];
window.__cardIntegrity = { calls };
window.fetch = async (input) => {
  const url = new URL(String(input), location.origin);
  if (!url.pathname.endsWith("/card")) return new Response("{}", { status: 404 });
  calls.push({ path: url.pathname, params: Object.fromEntries(url.searchParams) });
  const id = decodeURIComponent(url.pathname.split("/")[3]);
  const firstPlayer = id === "8137";
  const count = calls.filter(row => row.path === url.pathname).length;
  const recovery = state === "recovery" ? (count === 1 ? "queued" : count === 2 ? "running" : "completed")
    : state === "failed" ? (count === 1 ? "queued" : "failed") : state === "closing" ? "running" : state === "unsupported" ? "unsupported" : "idle";
  const waiting = ["queued", "running"].includes(recovery);
  const week = Number(url.searchParams.get("week") || 7);
  const season = Number(url.searchParams.get("season") || 2026);
  const result = {
    player_id: firstPlayer ? "00-0037247" : id,
    player_name: firstPlayer ? "George Pickens" : "Second Player",
    position: firstPlayer ? "wr" : "te",
    weekly_projection: waiting || state === "unsupported" ? null : { "Projected Points": state === "zero" ? 0 : firstPlayer ? 8.472 : 12.3, "Low (P10)": 0, "High (P90)": 17.5 },
    rest_of_season_projection: { p10: 40, p50: 80, p90: 120, games_remaining: 10 },
    game_log_season: season,
    game_log: [{ week: 4, opponent: "NYG", is_home: false, receptions: 0, receiving_yards: 0, touchdowns: 0, points: 0 }],
    season_to_date: { points: 0, ppg: 0, games_played: 1, complete: true, through_week: 4 },
    history_coverage: { status: "complete", recorded_weeks: [4] },
    meta: { season, week, identity: { status: state === "unresolved" ? "unresolved" : "resolved" },
      recovery: { status: recovery, retry_after_seconds: .01, reason: state === "unsupported" ? "unsupported_position" : undefined }, artifacts: { weekly: { status: waiting ? "missing" : "ready" }, ros: { status: state === "stale" ? "stale" : "ready" } } },
  };
  if (state === "partial") {
    result.history_coverage = { status: "partial", reason: "missing_recorded_games" };
    result.season_to_date = { ...result.season_to_date, points: null, ppg: null, complete: false };
  }
  if (state === "unavailable") { result.game_log = []; result.history_coverage = { status: "unavailable", reason: "invalid_source" }; }
  if (state === "unsupported") { result.position = "k"; result.game_log = []; result.history_coverage = { status: "unsupported" }; }
  if (state === "network-failure" && count > 1) throw new TypeError("Failed to fetch");
  if (state === "network-failure") result.meta.recovery.status = "running";
  // Deliberately ignore abort while parsing to reproduce the old late-body race.
  if (["race", "period-race"].includes(state) && firstPlayer && count === 1) return { ok: true, json: () => new Promise(resolve => setTimeout(() => resolve(result), 900)) };
  return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json" } });
};

function Launcher() {
  const card = usePlayerCard();
  useEffect(() => { window.__cardIntegrity.open = card.openPlayerCard; }, [card.openPlayerCard]);
  useEffect(() => { if (query.get("open") === "1") card.openPlayerCard({ playerId: "8137", name: "George Pickens", position: "wr" }); }, []);
  return <main id="main-content" style={{ padding: "var(--space-5)" }}>
    <h1>Player card verification</h1><p>Synthetic contract data · Production components</p>
    <button type="button" className="btn-ghost" style={{ minHeight: 44 }} onClick={() => card.openPlayerCard({ playerId: "8137", name: "George Pickens", position: "wr" })}>Open George Pickens</button>
  </main>;
}
createRoot(document.getElementById("root")).render(<PlayerCardProvider
  candidates={candidates} context={["provider-context", "scope-context"].includes(state) ? { season: 2025, week: 18 } : null}
  resetKey="integrity-fixture">{state === "scope-context" ? <PlayerCardReadScope context={{season:2024,week:9}}><Launcher /></PlayerCardReadScope> : <Launcher />}</PlayerCardProvider>);
