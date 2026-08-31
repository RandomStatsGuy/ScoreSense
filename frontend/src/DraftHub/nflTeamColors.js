/** Muted NFL team palettes for locker-room jerseys and nameplates.
 *
 * Tuned darker than broadcast colors so they sit inside the dark UI without
 * going neon (PRODUCT.md visual language). jersey = [top, bottom] gradient
 * stops; plate = nameplate base.
 */

const TEAM_COLORS = {
  ARI: { jersey: ["#8a1f33", "#4d0f1c"], plate: "#97283c" },
  ATL: { jersey: ["#a6192e", "#57101b"], plate: "#b02237" },
  BAL: { jersey: ["#241773", "#120a3d"], plate: "#2f1f8a" },
  BUF: { jersey: ["#1c4e8c", "#0e2a52"], plate: "#205a9e" },
  CAR: { jersey: ["#0085ca", "#00476e"], plate: "#0e93d6" },
  CHI: { jersey: ["#0b162a", "#050a14"], plate: "#c83803" },
  CIN: { jersey: ["#fb4f14", "#8a2c0b"], plate: "#d84512" },
  CLE: { jersey: ["#311d00", "#1a0f00"], plate: "#ff3c00" },
  DAL: { jersey: ["#26436e", "#132339"], plate: "#2f527f" },
  DEN: { jersey: ["#c2531c", "#732e0d"], plate: "#d55e20" },
  DET: { jersey: ["#1466a0", "#0a3a60"], plate: "#1a76b8" },
  GB: { jersey: ["#1e3a2f", "#0f1f19"], plate: "#c9a24a" },
  HOU: { jersey: ["#03202f", "#010f17"], plate: "#a71930" },
  IND: { jersey: ["#1c4e8c", "#0e2a52"], plate: "#205a9e" },
  JAX: { jersey: ["#0d6b6e", "#063a3c"], plate: "#0f7e82" },
  KC: { jersey: ["#a6192e", "#57101b"], plate: "#c8102e" },
  LA: { jersey: ["#1b3f8f", "#0d2050"], plate: "#b09018" },
  LAR: { jersey: ["#1b3f8f", "#0d2050"], plate: "#b09018" },
  LAC: { jersey: ["#0080c6", "#00456b"], plate: "#f2c34a" },
  LV: { jersey: ["#2b2b2e", "#151517"], plate: "#8a8d92" },
  MIA: { jersey: ["#008e97", "#004b50"], plate: "#0aa4ae" },
  MIN: { jersey: ["#4f2683", "#291345"], plate: "#5f2ea0" },
  NE: { jersey: ["#0b2242", "#051123"], plate: "#c60c30" },
  NO: { jersey: ["#3b3025", "#1f1a14"], plate: "#c9b48a" },
  NYG: { jersey: ["#1b3f8f", "#0d2050"], plate: "#2148a3" },
  NYJ: { jersey: ["#125740", "#082e22"], plate: "#17724f" },
  PHI: { jersey: ["#004c54", "#00272b"], plate: "#0a6a75" },
  PIT: { jersey: ["#2b2b2e", "#151517"], plate: "#c9971f" },
  SEA: { jersey: ["#0b2242", "#051123"], plate: "#69be28" },
  SF: { jersey: ["#8a1f2d", "#4a1018"], plate: "#b3995d" },
  TB: { jersey: ["#8a1c25", "#4a0f14"], plate: "#a2202b" },
  TEN: { jersey: ["#0c2340", "#061221"], plate: "#4b92db" },
  WAS: { jersey: ["#7a1f2b", "#4a1119"], plate: "#8f2433" },
  WSH: { jersey: ["#7a1f2b", "#4a1119"], plate: "#8f2433" },
};

const FALLBACK = { jersey: ["#2c3a52", "#182233"], plate: "#42536e" };

export function nflTeamColors(team) {
  const abbr = String(team || "").trim().toUpperCase();
  return TEAM_COLORS[abbr] || FALLBACK;
}
