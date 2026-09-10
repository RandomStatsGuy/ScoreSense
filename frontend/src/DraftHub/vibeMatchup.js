/** Matchup readout for Fantasy → Vibes front cards. */

import { opponentLabel } from "./vibeRankingsPresentation.js";

export const DEMO_VIBE_MATCHUPS = Object.freeze({
  "demo-allen": {
    site: "Home vs MIA",
    weather: "78° · 9 mph",
    line: "BUF -6.5 · O/U 50.5",
    kickoff: "Sun 1:00 PM",
  },
  "demo-bijan": {
    site: "Home vs TB",
    weather: "Dome",
    line: "ATL -3.0 · O/U 46.5",
    kickoff: "Sun 1:00 PM",
  },
  "demo-gibbs": {
    site: "Away @ GB",
    weather: "54° · 14 mph",
    line: "GB -2.5 · O/U 48.0",
    kickoff: "Sun 4:25 PM",
  },
  "demo-jefferson": {
    site: "Home vs CHI",
    weather: "Dome",
    line: "MIN -4.5 · O/U 44.5",
    kickoff: "Sun 1:00 PM",
  },
  "demo-puka": {
    site: "Away @ SEA",
    weather: "61° · 8 mph",
    line: "SEA -3.5 · O/U 44.5",
    kickoff: "Thu 8:20 PM",
  },
  "demo-cd": {
    site: "Home vs NYG",
    weather: "Dome",
    line: "DAL -7.0 · O/U 47.5",
    kickoff: "Sun 1:00 PM",
  },
  "demo-bowers": {
    site: "Away @ DEN",
    weather: "68° · 7 mph",
    line: "DEN -5.5 · O/U 41.5",
    kickoff: "Sun 4:05 PM",
  },
  "demo-kittle": {
    site: "Home vs ARI",
    weather: "Dome",
    line: "SF -6.0 · O/U 47.0",
    kickoff: "Sun 4:25 PM",
  },
  "demo-saquon": {
    site: "Home vs WAS",
    weather: "72° · 6 mph",
    line: "PHI -4.0 · O/U 45.5",
    kickoff: "Sun 1:00 PM",
  },
  "demo-sun-god": {
    site: "Away @ GB",
    weather: "54° · 14 mph",
    line: "GB -2.5 · O/U 48.0",
    kickoff: "Sun 4:25 PM",
  },
  "demo-bates": {
    site: "Away @ GB",
    weather: "54° · 14 mph",
    line: "GB -2.5 · O/U 48.0",
    kickoff: "Sun 4:25 PM",
  },
  "demo-lions-def": {
    site: "Away @ GB",
    weather: "54° · 14 mph",
    line: "GB -2.5 · O/U 48.0",
    kickoff: "Sun 4:25 PM",
  },
});

export const DEMO_VIBE_NEWS = Object.freeze({
  "demo-allen": {
    headline: "Full practice Wednesday",
    detail: "Sample player update for the demo roster.",
    kind: "practice",
    source: "Demo example",
  },
  "demo-bijan": {
    headline: "Feature back, no committee talk",
    detail: "Sample player update for the demo roster.",
    kind: "digest",
    source: "Demo example",
  },
  "demo-gibbs": {
    headline: "Limited Tuesday · ankle",
    detail: "Sample player update for the demo roster.",
    kind: "locker",
    source: "Demo example",
  },
  "demo-jefferson": {
    headline: "Full go after the bye-week rest",
    detail: "Sample player update for the demo roster.",
    kind: "practice",
    source: "Demo example",
  },
  "demo-puka": {
    headline: "No designation in Seattle",
    detail: "Sample player update for the demo roster.",
    kind: "status",
    source: "Demo example",
  },
  "demo-cd": {
    headline: "Questionable · hip",
    detail: "Sample player update for the demo roster.",
    kind: "locker",
    source: "Demo example",
  },
  "demo-bowers": {
    headline: "Every-down tight end",
    detail: "Sample player update for the demo roster.",
    kind: "digest",
    source: "Demo example",
  },
  "demo-kittle": {
    headline: "Full practice, no tag",
    detail: "Sample player update for the demo roster.",
    kind: "practice",
    source: "Demo example",
  },
  "demo-saquon": {
    headline: "Expected to handle early downs",
    detail: "Sample player update for the demo roster.",
    kind: "digest",
    source: "Demo example",
  },
  "demo-sun-god": {
    headline: "No injury tag",
    detail: "Sample player update for the demo roster.",
    kind: "status",
    source: "Demo example",
  },
  "demo-bates": {
    headline: "No designation",
    detail: "Sample player update for the demo roster.",
    kind: "status",
    source: "Demo example",
  },
  "demo-lions-def": {
    headline: "Full unit, no tags",
    detail: "Sample player update for the demo roster.",
    kind: "status",
    source: "Demo example",
  },
});

function lineNumber(value) {
  if (value == null || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export function formatWeather(ctx = {}) {
  const temp = lineNumber(ctx.temp);
  const wind = lineNumber(ctx.wind);
  const roof = String(ctx.roof || "").toLowerCase();
  const parts = [];
  if (temp != null) parts.push(`${Math.round(temp)}°`);
  if (wind != null && wind > 0) parts.push(`${Math.round(wind)} mph`);
  if (roof === "dome") parts.push("Dome");
  else if (roof.includes("retract")) parts.push("Retractable");
  else if ((roof === "outdoors" || roof === "open") && !parts.length) parts.push("Outdoors");
  else if (!roof && ctx.stadium && !parts.length) parts.push(String(ctx.stadium));
  return parts.join(" · ");
}

export function formatTeamLine(ctx = {}) {
  const spread = lineNumber(ctx.spread);
  const total = lineNumber(ctx.total_line);
  const bits = [];
  if (spread != null) {
    const signed = spread > 0 ? `+${spread}` : String(spread);
    bits.push(signed);
  }
  if (total != null) bits.push(`O/U ${total}`);
  return bits.join(" · ");
}

export function formatSite(player, ctx = {}) {
  if (player?.on_bye) return "Bye";
  if (ctx && ctx.opponent) {
    return ctx.is_home ? `Home vs ${ctx.opponent}` : `Away @ ${ctx.opponent}`;
  }
  const opp = opponentLabel(player);
  if (!opp || opp === "—") return "";
  const away = String(player?.opponent || "").startsWith("@");
  return away ? `Away ${opp}` : `Home ${opp}`;
}

export function matchupFacts(matchup) {
  if (!matchup) return [];
  const rows = [];
  if (matchup.site) rows.push({ id: "site", label: "Site", value: matchup.site });
  if (matchup.weather) rows.push({ id: "weather", label: "Weather", value: matchup.weather });
  if (matchup.line) rows.push({ id: "line", label: "Line", value: matchup.line });
  return rows;
}

export function buildVibeMatchup(player, vegasTeams = {}) {
  const demo = DEMO_VIBE_MATCHUPS[player?.player_id];
  if (demo) return { ...demo, facts: matchupFacts(demo) };
  const team = String(player?.team || "").trim().toUpperCase();
  const ctx = vegasTeams[team] || vegasTeams[team.replace("JAC", "JAX")] || {};
  const matchup = {
    site: formatSite(player, ctx),
    weather: formatWeather(ctx),
    line: formatTeamLine(ctx),
    kickoff: "",
  };
  return { ...matchup, facts: matchupFacts(matchup) };
}

export function buildVibeLatest(player, apiLatest) {
  const demo = DEMO_VIBE_NEWS[player?.player_id];
  if (demo) return demo;
  const row = apiLatest?.latest || apiLatest;
  if (!row || (!row.headline && !row.detail)) return null;
  return row;
}
