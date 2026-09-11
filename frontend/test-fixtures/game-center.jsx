// Production view with deterministic fixture data. No live league writes.
import React from "react";
import { createRoot } from "react-dom/client";
import GameCenter from "../src/DraftHub/GameCenter";
import { TeamIdentityProvider } from "../src/DraftHub/TeamIdentityContext";
import "../src/styles.css";
import "../src/styles/product-hierarchy.css";
import "../src/styles/product-rhythm.css";
import "../src/styles/fantasy-phone.css";
const params = new URLSearchParams(location.search);
const state = params.get("state") || "live";
const names = [
  ["Jalen Hurts", "QB", "PHI", 1, 15.3, "Justin Fields", "NYJ", 1],
  ["Blake Corum", "RB", "LAR", 24, 2.7, "Bucky Irving", "TB", 7],
  ["Travis Etienne", "RB", "NO", 3, 13.3, "D’Andre Swift", "CHI", 4],
  ["Malik Nabers", "WR", "NYG", 1, 9.7, "Jaylen Waddle", "MIA", 17],
  ["Christian Watson", "WR", "GB", 9, 8.5, "Amon-Ra St. Brown", "DET", 14],
  ["Parker Washington", "WR", "JAX", 11, 7.4, "Jerry Jeudy", "CLE", 3],
  ["Kyle Pitts", "TE", "ATL", 8, 8, "Tucker Kraft", "GB", 85],
  ["Travis Kelce", "FLEX", "KC", 87, 6.3, "Marvin Mims", "DEN", 19],
  ["Empty", "K", "", null, null, "Brandon Aubrey", "DAL", 17],
  ["Empty", "DEF", "", null, null, "New York Jets", "NYJ", null],
];
const starters = (side) =>
  names.map((r, i) => ({
    player_id: side === 0 && i > 7 ? "" : `${side}-${i}`,
    sleeper_player_id: `${side}-${i}`,
    name: r[side === 0 ? 0 : 5],
    position: r[1],
    team: r[side === 0 ? 2 : 6],
    jersey_number: r[side === 0 ? 3 : 7],
    proj: side === 0 ? r[4] : null,
    points: side === 0 && i === 1 ? 5.4 : 0,
  }));
const mine = {
  roster_id: "1",
  hub_team_id: "mine",
  is_viewer: true,
  team_name: "Immaculate Concepcion",
  owner_name: "Caleb K",
  points: 5.4,
  starters: starters(0),
  bench_players: [
    {
      player_id: "b1",
      name: "Jayden Daniels",
      team: "WAS",
      position: "QB",
      points: 0,
      proj: 18.7,
    },
  ],
};
const other = {
  roster_id: "2",
  hub_team_id: "other",
  team_name: "Thanks noob noob",
  owner_name: "Josh C",
  points: 0,
  starters: starters(1),
  bench_players: [],
};
const originalFetch = window.fetch.bind(window);
window.fetch = async (input, options) => {
  const url = new URL(
    typeof input === "string" ? input : input.url,
    location.origin,
  );
  if (!url.pathname.startsWith("/api/")) return originalFetch(input, options);
  if (url.pathname.includes("/media/"))
    return originalFetch("/art/team-room/locker-interior.webp", options);
  let payload = {};
  if (url.pathname.endsWith("/identities"))
    payload = {
      identities: params.has("noart")
        ? {}
        : {
            mine: {
              banner_media_id: "mine",
              banner_focus: { x: 30, y: 50, zoom: 1 },
            },
            other: { banner_media_id: "other" },
          },
    };
  if (url.pathname.includes("live-scoring")) {
    if (state === "loading") return new Promise(() => {});
    if (state === "error")
      return new Response(JSON.stringify({ detail: "Fixture unavailable" }), {
        status: 503,
      });
    payload = {
      available: true,
      season: 2026,
      week: Number(url.searchParams.get("week") || 1),
      current_week: state === "final" ? 2 : 1,
      max_week: 18,
      viewer_matchup_id: "1",
      starting_slots: names.map((r) => r[1]),
      synced_at: new Date().toISOString(),
      live: state === "live",
      week_complete: state === "final",
      placeholder: state === "pregame",
      matchups:
        state === "empty"
          ? []
          : [
              { matchup_id: "1", teams: [mine, other] },
              {
                matchup_id: "2",
                teams: [
                  { roster_id: "3", owner_name: "Aaron D", points: 0 },
                  { roster_id: "4", owner_name: "Andrew M", points: 0 },
                ],
              },
            ],
      standings: [],
    };
  }
  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json" },
  });
};
const context = {
  mode: "league",
  league_id: "fixture",
  team_id: "mine",
  draft_completed: true,
  sleeper_league_id: "fixture",
};
createRoot(document.getElementById("root")).render(
  <main id="main-content" style={{ maxWidth: 1510, margin: "auto" }}>
    <TeamIdentityProvider leagueId="fixture">
      <GameCenter
        leagueId="fixture"
        hubContext={context}
        requestedWeek={params.get("matchupWeek")}
        requestedTeam={params.get("matchupTeam")}
        onNavigate={(view) => {
          document.getElementById("navigation-result").textContent = view;
        }}
      />
    </TeamIdentityProvider>
    <output id="navigation-result" />
  </main>,
);
