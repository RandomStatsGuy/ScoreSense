/** Copy for Account → Model accuracy. */

export const ACCURACY_COPY = {
  heading: "Check the miss before you start someone.",
  support: (seasonRange) => (
    seasonRange
      ? `Past seasons (${seasonRange}), pre-kickoff only. A fat miss here is a sit you would have gotten wrong.`
      : "Past seasons, pre-kickoff only. A fat miss here is a sit you would have gotten wrong."
  ),
  lead: "Each week uses only what you would have had Sunday morning. We compare that number to a simple guess: season average plus last game.",
  moreAccurate: "Tighter than a quick guess.",
  moreAccurateBody: (posLabel, miss, guessMiss, beats, total) => (
    `Typical miss for ${posLabel} was about ${miss} fantasy points — tighter than blending season average with last game (${guessMiss}). Closer in ${beats} of ${total} tested seasons.`
  ),
  boomTitle: "Better at flagging big weeks.",
  boomBody: (boomPct) => (
    `When a player popped for a huge score, the high-end number had them on the radar about ${boomPct} of the time.`
  ),
  noPeek: "No peeking at the future.",
  noPeekBody: "Each projection uses only prior weeks in that season — the same way you would use the app on Sunday morning.",
  missLabel: "Typical weekly miss",
  missSub: "Closer to actual = better",
  beatLabel: "Beat the simple guess",
  beatSub: "Seasons we were closer",
  boomLabel: "Big games flagged early",
  boomSub: "Before the breakout happened",
  allSeasons: (total) => `ScoreSense beat the simple baseline every season we tested (${total}).`,
  resultsHeading: "Backtest results",
  resultsSupport: (seasonRange) => `${seasonRange} · pre-kickoff weekly projections`,
};

export function typicalMissLine({ position, miss } = {}) {
  const pts = Number(miss);
  if (!Number.isFinite(pts)) return "";
  const pos = String(position || "QB").trim().toUpperCase() || "QB";
  return `${pos} typical miss · ${pts.toFixed(1)} pts`;
}
