/** Shared sentiment display helpers for weekly narrative UI. */

export function playerSentimentKey(name, team) {
  return `${String(name || "").trim().toLowerCase()}|${String(team || "").trim().toUpperCase()}`;
}

export function sentimentFromScore(score, { injuryFlag = 0, roleHypeFlag = 0 } = {}) {
  const s = Number(score) || 0;
  const injury = Number(injuryFlag) || 0;
  const hype = Number(roleHypeFlag) || 0;
  if (injury > 0 && s <= -0.05) return "caution";
  if (hype > 0 && s >= 0.05) return "hype";
  if (s >= 0.2) return "bullish";
  if (s <= -0.2) return "bearish";
  if (Math.abs(s) < 0.08) return "neutral";
  return "mixed";
}

const LABEL_TEXT = {
  bullish: "Bullish",
  bearish: "Bearish",
  caution: "Injury concern",
  hype: "Role hype",
  neutral: "Neutral",
  mixed: "Mixed",
};

export function sentimentLabelText(label) {
  return LABEL_TEXT[label] || "Neutral";
}

export function buildSentimentMap(players) {
  const map = new Map();
  for (const row of players || []) {
    map.set(playerSentimentKey(row.player, row.team), row);
    if (row.player_id) {
      map.set(String(row.player_id), row);
    }
  }
  return map;
}

export function resolveRowSentiment(sentimentMap, row) {
  if (!sentimentMap || !row) return null;
  const byId = row.player_id && sentimentMap.get(String(row.player_id));
  if (byId) return byId;
  return sentimentMap.get(playerSentimentKey(row.Player ?? row.player, row.Team ?? row.team)) || null;
}

export function sentimentToneClass(label) {
  switch (label) {
    case "bullish":
    case "hype":
      return "sentiment-tone-bullish";
    case "bearish":
    case "caution":
      return "sentiment-tone-bearish";
    case "mixed":
      return "sentiment-tone-mixed";
    default:
      return "sentiment-tone-neutral";
  }
}
