/** Aggregate weekly narrative data for charts and summary cards. */

import { sentimentLabelText } from "./sentimentDisplay";

export const TONE_COLORS = {
  bullish: "#34d399",
  hype: "#6ee7b7",
  bearish: "#f87171",
  caution: "#fb923c",
  mixed: "#fbbf24",
  neutral: "#64748b",
};

const TONE_ORDER = ["bullish", "hype", "neutral", "mixed", "caution", "bearish"];

export function shortPlayerName(name) {
  const parts = String(name || "").trim().split(/\s+/);
  if (parts.length <= 1) return parts[0] || "?";
  return `${parts[0][0]}. ${parts[parts.length - 1]}`;
}

function cleanMentions(value) {
  const n = Number(value) || 0;
  return Math.round(n * 10) / 10;
}

function cleanScore(value) {
  const n = Number(value) || 0;
  return Math.round(n * 100) / 100;
}

export function aggregateWeekSentiment(players) {
  const list = players || [];
  const toneCounts = Object.fromEntries(TONE_ORDER.map((t) => [t, 0]));
  const totalMentions = Math.round(
    list.reduce((sum, row) => sum + (Number(row.mention_count) || 0), 0)
  );
  let injuryFlags = 0;
  let hypeFlags = 0;
  let scoreSum = 0;
  const networkCounts = {};

  for (const row of list) {
    const label = row.sentiment_label || "neutral";
    toneCounts[label] = (toneCounts[label] || 0) + 1;
    if (Number(row.injury_flag) > 0) injuryFlags += 1;
    if (Number(row.role_hype_flag) > 0) hypeFlags += 1;
    scoreSum += Number(row.sentiment_score) || 0;

    for (const src of row.sources || []) {
      const key = src.network_label || src.label || src.network || "other";
      networkCounts[key] = (networkCounts[key] || 0) + 1;
    }
  }

  const playerCount = list.length;
  const bullishish = (toneCounts.bullish || 0) + (toneCounts.hype || 0);
  const bearishish = (toneCounts.bearish || 0) + (toneCounts.caution || 0);

  const toneChartData = TONE_ORDER.filter((t) => toneCounts[t] > 0).map((tone) => ({
    tone,
    label: sentimentLabelText(tone),
    count: toneCounts[tone],
    fill: TONE_COLORS[tone],
  }));

  const buzzLeaders = [...list]
    .sort((a, b) => (Number(b.mention_count) || 0) - (Number(a.mention_count) || 0))
    .slice(0, 10)
    .map((row) => ({
      player: row.player,
      shortName: shortPlayerName(row.player),
      team: row.team,
      mentions: cleanMentions(row.mention_count),
      score: cleanScore(row.sentiment_score),
      tone: row.sentiment_label || "neutral",
      fill: TONE_COLORS[row.sentiment_label] || TONE_COLORS.neutral,
    }));

  const spectrumData = [...list]
    .sort((a, b) => (Number(b.mention_count) || 0) - (Number(a.mention_count) || 0))
    .slice(0, 12)
    .map((row) => ({
      player: row.player,
      shortName: shortPlayerName(row.player),
      team: row.team,
      mentions: cleanMentions(row.mention_count),
      score: cleanScore(row.sentiment_score),
      tone: row.sentiment_label || "neutral",
      fill: TONE_COLORS[row.sentiment_label] || TONE_COLORS.neutral,
    }));

  const networkChartData = Object.entries(networkCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, count]) => ({ name, count }));

  return {
    playerCount,
    totalMentions,
    injuryFlags,
    hypeFlags,
    avgScore: playerCount ? scoreSum / playerCount : 0,
    bullishPct: playerCount ? Math.round((bullishish / playerCount) * 100) : 0,
    bearishPct: playerCount ? Math.round((bearishish / playerCount) * 100) : 0,
    toneCounts,
    toneChartData,
    buzzLeaders,
    spectrumData,
    networkChartData,
  };
}
