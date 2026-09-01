/**
 * Projections board + player inspector copy and derived reads.
 * Keep JSX structural; user-facing strings live here.
 */

import { isPlayerUnavailable } from "./format.js";
import { isLeftSlate } from "./projectionMovement.js";
import { isScheduleAwareMethod, resolveSeasonBand, upsideSkew } from "./seasonQuantiles.js";

export const POSITION_SHORT = {
  qb: "QB",
  rb: "RB",
  wr: "WR/TE",
};

export const STARTER_CUTOFF = {
  qb: 12,
  rb: 24,
  wr: 36,
};

export const SEASON_BOARD_FILTERS = [
  { id: "all", label: "All" },
  { id: "starters", label: "Starters" },
  { id: "upside", label: "Upside" },
];

export const BOARD_COPY = {
  weeklyBoard: "The board",
  weeklySupport: "One dense surface for ranking, matchup, range, and comparison.",
  seasonBoard: "The season board",
  seasonSupport: "Scan the full pool, then open a player for floor, ceiling, and method.",
  searchBoard: "Search the board",
  searchInspector: "Find a player",
  whyNow: "Why now",
  read: "Read",
  injuries: "Injuries",
  analyst: "Analyst context",
  addPlayer: "Add player",
  scheduleAware: "Schedule-aware estimate",
  preseasonEstimate: "Preseason estimate",
  liveSeason: "Live season + ROS",
  weeklyModel: "Weekly PPR model",
};

export function positionShort(position) {
  const key = String(position || "").trim().toLowerCase();
  if (POSITION_SHORT[key]) return POSITION_SHORT[key];
  const upper = key.toUpperCase();
  if (upper === "WR" || upper === "TE") return "WR/TE";
  return upper || "";
}

export function starterCutoff(position) {
  const key = String(position || "").trim().toLowerCase();
  return STARTER_CUTOFF[key] || STARTER_CUTOFF.wr;
}

export function weeklyQuantiles(row) {
  if (!row) return { p10: null, p50: null, p90: null, spread: null };
  const p10 = Number(row["Low (P10)"]);
  const p50 = Number(row["Projected Points"]);
  const p90 = Number(row["High (P90)"]);
  const ok = [p10, p50, p90].every(Number.isFinite);
  return {
    p10: Number.isFinite(p10) ? p10 : null,
    p50: Number.isFinite(p50) ? p50 : null,
    p90: Number.isFinite(p90) ? p90 : null,
    spread: ok ? p90 - p10 : null,
  };
}

export function median(values) {
  const nums = (values || []).filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

export function percentile(values, pct) {
  const nums = (values || []).filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!nums.length) return null;
  const p = Math.min(100, Math.max(0, Number(pct) || 0));
  const idx = Math.min(nums.length - 1, Math.max(0, Math.ceil((p / 100) * nums.length) - 1));
  return nums[idx];
}

export function isBoardAvailable(row) {
  if (!row) return false;
  if (isLeftSlate(row)) return false;
  return !isPlayerUnavailable(row["Injury Status"]);
}

export function weeklyPeerStats(rows) {
  const available = (rows || []).filter(isBoardAvailable);
  const bands = available.map(weeklyQuantiles);
  const spreads = bands.map((b) => b.spread);
  const p50s = bands.map((b) => b.p50);
  const p10s = bands.map((b) => b.p10);
  return {
    count: available.length,
    medianSpread: median(spreads),
    medianP50: median(p50s),
    maxSpread: spreads.length ? Math.max(...spreads.filter(Number.isFinite)) : null,
    p50P90: percentile(p50s, 90),
    topFloor: p10s.length ? Math.max(...p10s.filter(Number.isFinite)) : null,
  };
}

function clauseJoin(parts) {
  const clean = parts.filter(Boolean);
  if (!clean.length) return "";
  return clean.join("; ");
}

/**
 * Short board read for a weekly row. Uses peer spread / median, not LLM copy.
 */
export function weeklyWhyNow(row, peers = {}, { rank, position } = {}) {
  if (!isBoardAvailable(row)) {
    if (isLeftSlate(row)) return "Left this week's slate";
    const status = String(row?.["Injury Status"] || "").trim();
    return status ? `Projection suppressed — ${status}` : "Projection suppressed";
  }
  const band = weeklyQuantiles(row);
  if (band.p50 == null) return "Waiting on a projection";

  const pos = positionShort(position) || "this position";
  const cutoff = starterCutoff(position);
  const starter = rank != null && rank <= cutoff;
  const elite = (rank != null && rank <= 3) || (peers.p50P90 != null && band.p50 >= peers.p50P90);
  const wide =
    band.spread != null &&
    peers.medianSpread != null &&
    peers.medianSpread > 0 &&
    band.spread >= peers.medianSpread * 1.15;
  const tight =
    band.spread != null &&
    peers.medianSpread != null &&
    peers.medianSpread > 0 &&
    band.spread <= peers.medianSpread * 0.85;
  const safestFloor =
    band.p10 != null && peers.topFloor != null && Math.abs(band.p10 - peers.topFloor) < 0.05;
  const highVariance =
    band.spread != null &&
    peers.maxSpread != null &&
    starter &&
    Math.abs(band.spread - peers.maxSpread) < 0.05;

  const lead = elite
    ? "Elite median"
    : safestFloor
      ? `Safest floor among leading ${pos}s`
      : starter
        ? "Expected starter"
        : "Depth look";
  const range = highVariance
    ? "highest-variance starter this week"
    : wide
      ? "wider-than-average outcome band"
      : tight
        ? "tighter-than-average outcome band"
        : null;
  return clauseJoin([lead, range]);
}

export function seasonPeerStats(rows, { method } = {}) {
  const bands = (rows || []).map((row) => resolveSeasonBand(row, { method }));
  const spreads = bands.map((b) => b.spread);
  const p50s = bands.map((b) => b.p50);
  const p90s = bands.map((b) => b.p90);
  return {
    count: rows?.length || 0,
    medianSpread: median(spreads),
    medianP50: median(p50s),
    maxP50: p50s.length ? Math.max(...p50s.filter(Number.isFinite)) : null,
    maxP90: p90s.length ? Math.max(...p90s.filter(Number.isFinite)) : null,
    spreadP75: percentile(spreads, 75),
    tightestTop: tightestAmongLeaders(rows, { method, limit: 8 }),
  };
}

function tightestAmongLeaders(rows, { method, limit = 8 } = {}) {
  const ranked = (rows || [])
    .map((row) => ({ row, band: resolveSeasonBand(row, { method }) }))
    .filter((item) => item.band.p50 != null && item.band.spread != null)
    .sort((a, b) => b.band.p50 - a.band.p50)
    .slice(0, limit);
  if (!ranked.length) return null;
  return ranked.reduce((best, item) => (
    !best || item.band.spread < best.band.spread ? item : best
  ));
}

export function seasonRead(row, peers = {}, { rank, position, method } = {}) {
  const band = resolveSeasonBand(row, { method });
  if (band.p50 == null) return "Waiting on a projection";
  const pos = positionShort(position) || "this position";
  const cutoff = starterCutoff(position);
  const starter = rank != null && rank <= cutoff;
  const wide =
    band.spread != null &&
    peers.medianSpread != null &&
    peers.medianSpread > 0 &&
    band.spread >= peers.medianSpread * 1.15;
  const tight =
    band.spread != null &&
    peers.medianSpread != null &&
    peers.medianSpread > 0 &&
    band.spread <= peers.medianSpread * 0.85;
  const bestCeiling =
    band.p90 != null && peers.maxP90 != null && Math.abs(band.p90 - peers.maxP90) < 0.5;
  const tightestTop =
    peers.tightestTop?.row &&
    (peers.tightestTop.row.player_id
      ? String(peers.tightestTop.row.player_id) === String(row.player_id)
      : peers.tightestTop.row.Player === row.Player);
  const skew = band.skew ?? upsideSkew(band.p10, band.p50, band.p90);

  const lead = bestCeiling
    ? "Best ceiling"
    : tightestTop
      ? `Tightest band among leading ${pos}s`
      : starter
        ? "Expected starter"
        : "Upside / depth";
  const range = tightestTop
    ? null
    : wide
      ? "meaningfully wider band"
      : tight
        ? "stable, compact range"
        : skew != null && skew > 1.2
          ? "ceiling-skewed range"
          : null;
  return clauseJoin([lead, range]);
}

export function matchesSeasonBoardFilter(filterId, { rank, spread, peers, position } = {}) {
  const id = String(filterId || "all");
  if (id === "starters") {
    return rank != null && rank <= starterCutoff(position);
  }
  if (id === "upside") {
    if (spread == null || peers?.spreadP75 == null) return false;
    return spread >= peers.spreadP75;
  }
  return true;
}

export function movementBoardFilters(count) {
  const n = Number.isFinite(Number(count)) ? Number(count) : null;
  return [
    { id: "all", label: n != null ? `All ${n}` : "All" },
    { id: "movers", label: "Movers" },
    { id: "risers", label: "Risers" },
    { id: "fallers", label: "Fallers" },
  ];
}

export function seasonBoardFilters(count) {
  const n = Number.isFinite(Number(count)) ? Number(count) : null;
  return SEASON_BOARD_FILTERS.map((f) => (
    f.id === "all" && n != null ? { ...f, label: `All ${n}` } : f
  ));
}

function playerName(row) {
  return String(row?.Player || row?.player_name || row?.name || "").trim();
}

export function weeklyBoardSignals(rows, { attentionItems = [], position } = {}) {
  const available = (rows || []).filter(isBoardAvailable);
  const pos = positionShort(position);
  const top = available.reduce((best, row) => {
    const p50 = weeklyQuantiles(row).p50;
    if (p50 == null) return best;
    if (!best || p50 > best.value) return { row, value: p50 };
    return best;
  }, null);
  const floor = available.reduce((best, row) => {
    const p10 = weeklyQuantiles(row).p10;
    if (p10 == null) return best;
    if (!best || p10 > best.value) return { row, value: p10 };
    return best;
  }, null);
  const riser = available.reduce((best, row) => {
    const delta = Number(row.rank_delta);
    if (!Number.isFinite(delta) || delta <= 0) return best;
    if (!best || delta > best.value) return { row, value: delta };
    return best;
  }, null);
  const attention = (attentionItems || []).filter(Boolean);
  const first = attention[0];
  const firstName = first?.injury?.full_name || playerName(first?.projectionRow);
  const firstStatus = String(first?.status || "").trim();
  const statusShort = /questionable/i.test(firstStatus)
    ? "Q"
    : /doubtful/i.test(firstStatus)
      ? "D"
      : firstStatus;

  return [
    {
      id: "top",
      kicker: "Top projection",
      name: top ? playerName(top.row) : "—",
      value: top ? `${top.value.toFixed(1)} P50` : "—",
      playerId: top?.row?.player_id || null,
      row: top?.row || null,
    },
    {
      id: "floor",
      kicker: "Safest floor",
      name: floor ? playerName(floor.row) : "—",
      value: floor ? `${floor.value.toFixed(1)} P10` : "—",
      playerId: floor?.row?.player_id || null,
      row: floor?.row || null,
    },
    {
      id: "riser",
      kicker: "Biggest riser",
      name: riser ? playerName(riser.row) : "—",
      value: riser
        ? `▲${riser.value}${pos && riser.row.previous_rank != null && riser.row.current_rank != null
          ? ` · ${pos}${riser.row.previous_rank} → ${pos}${riser.row.current_rank}`
          : ""}`
        : "No material riser",
      playerId: riser?.row?.player_id || null,
      row: riser?.row || null,
      tone: riser ? "up" : null,
    },
    {
      id: "attention",
      kicker: "Attention",
      name: attention.length
        ? `${attention.length} starter${attention.length === 1 ? "" : "s"}`
        : "No slate injuries",
      value: firstName
        ? `${firstName}${statusShort ? ` · ${statusShort}` : ""}`
        : "Clear",
      playerId: first?.playerId || first?.projectionRow?.player_id || null,
      row: first?.projectionRow || null,
      tone: attention.length ? "caution" : "ok",
    },
  ];
}

export function seasonBoardSignals(rows, { method, featureSeason, draftSeason, scope = "preseason" } = {}) {
  const list = rows || [];
  const bandMethod = scope === "live" ? undefined : method;
  const peers = seasonPeerStats(list, { method: bandMethod });
  const top = list.reduce((best, row) => {
    const band = resolveSeasonBand(row, { method: bandMethod });
    if (band.p50 == null) return best;
    if (!best || band.p50 > best.band.p50) return { row, band };
    return best;
  }, null);
  const ceiling = list.reduce((best, row) => {
    const band = resolveSeasonBand(row, { method: bandMethod });
    if (band.p90 == null) return best;
    if (!best || band.p90 > best.band.p90) return { row, band };
    return best;
  }, null);
  const tight = peers.tightestTop;
  const perGame = top?.row?.["Per-Game Proj"];
  const scheduleAware = scope !== "live" && isScheduleAwareMethod(method);
  const modelValue = scheduleAware
    ? "Schedule-aware"
    : scope === "live"
      ? "Live season + ROS"
      : "Preseason estimate";
  const modelMeta = [
    scope !== "live" && featureSeason != null && draftSeason != null && featureSeason < draftSeason
      ? `${featureSeason} inputs`
      : null,
    scheduleAware ? "Bye weeks included" : "Calibrated as games are played",
  ].filter(Boolean).join(" · ");

  return [
    {
      id: "top",
      kicker: "Top P50",
      name: top ? playerName(top.row) : "—",
      value: top
        ? `${Math.round(top.band.p50)}${Number.isFinite(Number(perGame)) ? ` · ${Number(perGame).toFixed(1)} /gm` : ""}`
        : "—",
      playerId: top?.row?.player_id || null,
      row: top?.row || null,
    },
    {
      id: "ceiling",
      kicker: "Top ceiling",
      name: ceiling ? playerName(ceiling.row) : "—",
      value: ceiling
        ? `${Math.round(ceiling.band.p90)}${ceiling.band.spread != null ? ` · ${Math.round(ceiling.band.spread)}-pt spread` : ""}`
        : "—",
      playerId: ceiling?.row?.player_id || null,
      row: ceiling?.row || null,
    },
    {
      id: "tight",
      kicker: "Tightest top range",
      name: tight ? playerName(tight.row) : "—",
      value: tight?.band
        ? `${Math.round(tight.band.p10)}–${Math.round(tight.band.p90)}`
        : "—",
      playerId: tight?.row?.player_id || null,
      row: tight?.row || null,
    },
    {
      id: "model",
      kicker: "Model",
      name: modelValue,
      value: modelMeta || "P10–P90 season range",
      playerId: null,
      row: null,
    },
  ];
}

export function injuryDisclosureSummary({ count = 0, attentionCount = 0, name, status } = {}) {
  if (!count) return "No injuries in this filter.";
  const attn = attentionCount
    ? `${attentionCount} projected starter${attentionCount === 1 ? "" : "s"} need${attentionCount === 1 ? "s" : ""} attention`
    : "no projected starters need attention";
  const lead = name
    ? `${count} — ${attn}${status ? ` (${name} · ${status})` : ""}`
    : `${count} — ${attn}`;
  return lead;
}

export function analystDisclosureSummary({
  count = 0,
  week,
  historicalAvailable = false,
  loading = false,
} = {}) {
  if (loading) return "Loading analyst notes…";
  if (count > 0) {
    return week != null
      ? `${count} current Week ${week} notes`
      : `${count} current notes`;
  }
  if (historicalAvailable) {
    return week != null
      ? `No current Week ${week} notes; older coverage available.`
      : "No current notes; older coverage available.";
  }
  return week != null
    ? `No current Week ${week} notes.`
    : "No analyst notes for this slate.";
}

export function weeklyBoardKicker({ week, scoring = "PPR" } = {}) {
  if (week == null) return scoring;
  return `Week ${week} · ${scoring}`;
}

export function seasonBoardKicker({ season, mode, scheduleAware } = {}) {
  if (mode === "live") return season != null ? `${season} live season` : "Live season";
  if (scheduleAware) return season != null ? `${season} preseason · schedule-aware` : "Preseason · schedule-aware";
  return season != null ? `${season} preseason` : "Preseason";
}

export function roleOutlook({ rank, position, injuryStatus, rookie } = {}) {
  const status = String(injuryStatus || "").trim();
  if (status && /out|ir|pup|inactive|suspended/i.test(status)) {
    return {
      title: "Unavailable",
      detail: `${status} — volume assumptions are off until they return.`,
    };
  }
  if (status && /questionable|doubtful/i.test(status)) {
    return {
      title: "Availability risk",
      detail: `${status}. Projection still assumes a role if they play.`,
    };
  }
  const cutoff = starterCutoff(position);
  if (rank != null && rank <= Math.min(3, cutoff)) {
    return {
      title: "Locked-in starter",
      detail: "Volume and availability assumptions remain visible.",
    };
  }
  if (rank != null && rank <= cutoff) {
    return {
      title: "Expected starter",
      detail: "Volume and availability assumptions remain visible.",
    };
  }
  if (rookie) {
    return {
      title: "Rookie role estimate",
      detail: "Early-career usage is an estimate, not a locked-in snap share.",
    };
  }
  return {
    title: "Depth / dart throw",
    detail: "Needs an injury or role change before this is a weekly plan.",
  };
}

export function methodInsight({ scope, scheduleAware, applyInjuryAdjustments, seasonMode } = {}) {
  if (scope === "season") {
    if (seasonMode === "live") {
      return {
        title: "Live season + ROS",
        detail: "Points scored plus remaining weeks. Bands update as games land.",
      };
    }
    if (scheduleAware) {
      return {
        title: "Schedule-aware total",
        detail: "Bye weeks and expected games are included.",
      };
    }
    return {
      title: "Preseason estimate",
      detail: "Bands tighten as games are played.",
    };
  }
  return {
    title: applyInjuryAdjustments === false ? "Base weekly model" : "Weekly PPR model",
    detail: applyInjuryAdjustments === false
      ? "Live opportunity adjustments are off for this week."
      : "Floor, median, and ceiling for this week’s slate.",
  };
}

export function analystInsight({ narrative, historicalLabel } = {}) {
  if (narrative) {
    return {
      title: historicalLabel ? `Older coverage · ${historicalLabel}` : "Current notes",
      detail: "Source notes stay separate from the model result.",
    };
  }
  return {
    title: "Outlook on demand",
    detail: "Source notes stay separate from the model result.",
  };
}

export function rangeInsight(text) {
  const raw = String(text || "").trim();
  if (!raw) {
    return {
      title: "Range pending",
      detail: "Open once P10–P90 lands for this player.",
    };
  }
  const [title, ...rest] = raw.split(";").map((s) => s.trim()).filter(Boolean);
  return {
    title: title || "Range read",
    detail: rest.join(" ") || "P10–P90 is the outcome band, not a guarantee.",
  };
}

export function filterInspectorCandidates(candidates, query, { limit = 8 } = {}) {
  const q = String(query || "").trim().toLowerCase();
  const list = (candidates || []).filter((c) => c?.playerId);
  if (!q) return list.slice(0, limit);
  return list
    .filter((c) => {
      const name = String(c.name || "").toLowerCase();
      const team = String(c.team || "").toLowerCase();
      return name.includes(q) || team.includes(q);
    })
    .slice(0, limit);
}
