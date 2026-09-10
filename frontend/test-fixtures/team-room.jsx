// Production components with deterministic API responses; excluded from Vite production entry.
import React from "react";
import { createRoot } from "react-dom/client";
import RosterBuilder from "../src/DraftHub/RosterBuilder";
import TeamRoom from "../src/DraftHub/TeamRoom";
import DesktopPrimaryHeader from "../src/layout/DesktopPrimaryHeader";
import "../src/styles.css";
import "../src/styles/product-hierarchy.css";
import "../src/styles/product-rhythm.css";
import "../src/styles/fantasy-phone.css";
import "../src/styles/fantasy-header.css";
const params = new URLSearchParams(location.search);
const state = params.get("state") || "live";
const rows = [
  ["Jalen Hurts", "QB", "PHI", 1, 24.6, 23, 9],
  ["Jayden Daniels", "QB", "WAS", 5, 21.4, 22, 11],
  ["Breece Hall", "RB", "NYJ", 20, 17.8, 16, 26],
  ["TreVeyon Henderson", "RB", "NE", 32, 7.2, 14, 29],
  ["Malik Nabers", "WR", "NYG", 1, 19.6, 17, 12],
  ["Christian Watson", "WR", "GB", 9, 4.1, 10, 13],
  ["Kyle Pitts", "TE", "ATL", 8, 8.2, 9, 6],
  ["Travis Etienne", "RB", "NO", 1, 12.3, 13, 15],
  ["Parker Washington", "WR", "JAX", 11, 6.4, 8, 6],
  ["Travis Kelce", "TE", "KC", 87, 3, 8, 3],
  ["Dylan Sampson", "RB", "CLE", 22, 5, 8, 5],
];
const roster = rows.map((r) => ({
  player_id: r[0],
  player_name: r[0],
  position: r[1],
  team: r[2],
  salary: r[6],
  contract_years: 1,
  contract: { years_remaining: 1, contract_type: "veteran" },
  roster_status: "active",
}));
const players = rows.map((r) => ({
  player_id: r[0],
  name: r[0],
  position: r[1],
  slot: r[1],
  team: r[2],
  points: state === "pregame" ? null : r[4],
  projection: r[5],
  nickname: r[0] === "Malik Nabers" ? "The Neighborhood" : "",
  sleeper_nickname: "",
}));
const media = Object.fromEntries(
  rows.map((r) => [r[0], { jersey_number: r[3] }]),
);
const data = {
  team: { id: "mine", name: "Immaculate Concepcion", owner_name: "Caleb K" },
  theme: params.get("theme") || "cozy",
  season: 2026,
  week: 6,
  current_week: 6,
  max_week: 18,
  state,
  can_edit: !params.has("readonly"),
  starters: players.slice(0, 9),
  bench: players.slice(9),
  score: state === "pregame" ? null : 121.6,
  opponent: {
    name: "Sunday Rivals",
    score: state === "pregame" ? null : 118.4,
  },
  media,
  synced_at: new Date().toISOString(),
  teams: [
    { id: "mine", name: "Immaculate Concepcion", owner_name: "Caleb K" },
    { id: "other", name: "Sunday Rivals", owner_name: "Andrew M" },
  ],
};
if (params.has("empty")) {
  data.starters = [];
  data.bench = [];
}
window.__requests = [];
const original = window.fetch.bind(window);
window.fetch = async (url, options = {}) => {
  const path = String(url);
  if (!path.startsWith("/api/")) return original(url, options);
  window.__requests.push({ path, method: options.method || "GET" });
  if (path.includes("/room/nicknames/")) {
    const pid = decodeURIComponent(path.split("/").pop());
    const value = JSON.parse(options.body).nickname;
    for (const p of players) if (p.player_id === pid) p.nickname = value || "";
    return Response.json({ saved: true });
  }
  if (path.endsWith("/room/share")) {
    data.share_token = JSON.parse(options.body).enabled
      ? "fixture-share-token"
      : null;
    return Response.json({ share_token: data.share_token });
  }
  if (path.includes("/room") || path.includes("/shared-room")) {
    if (params.has("error"))
      return Response.json({ detail: "Unavailable" }, { status: 503 });
    const week = new URL(path, location.origin).searchParams.get("week");
    return Response.json({
      ...data,
      week: week ? Number(week) : 6,
      ...(path.includes("/other/")
        ? { team: { id: "other", name: "Sunday Rivals" }, can_edit: false }
        : {}),
    });
  }
  return Response.json({ media_by_player_id: media });
};
const context = {
  mode: "league",
  team_id: "mine",
  league_id: "fixture",
  team_name: "Immaculate Concepcion",
  draft_completed: true,
};
createRoot(document.getElementById("root")).render(
  <div className="app">
    <header className="app-header app-header--hub">
      <div className="app-header-shell">
        <DesktopPrimaryHeader
          productName="ScoreSense"
          studioName="4th Down Labs"
          sections={[{ id: "hub", label: "Fantasy" }]}
          view="hub"
          pathForSection={() => "/hub/roster"}
          onNavigate={() => {}}
        />
      </div>
    </header>
    <main id="main-content">
      <div className="draft-hub">
        {params.has("readonly") ? (
          <TeamRoom token="fixture" />
        ) : (
          <RosterBuilder
            roster={roster}
            valueRows={[]}
            workspace={{
              season: 2026,
              rules: { salary_cap: 200, contracts: { max_years: 3 } },
            }}
            hubContext={context}
            capSheet={{ summary: { dead_cap: 9 } }}
            onNavigate={() => {}}
          />
        )}
      </div>
    </main>
  </div>,
);
