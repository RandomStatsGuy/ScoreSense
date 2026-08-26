import { upsideSkew } from "../seasonQuantiles";
import { normalizeHubPosition } from "./hubPositions";

export const TIER_ORDER = {
  Elite: 0,
  "Tier 1": 1,
  "Tier 2": 2,
  "Tier 3": 3,
  Depth: 4,
  "—": 5,
};

export const STATUS_ORDER = {
  available: 0,
  pass: 0,
  target: 1,
  sleeper: 2,
  rostered: 3,
  mine: 4,
  taken: 5,
};

export { fmtSal } from "./rosterFormat";

const STATUS_LABELS = {
  available: "Free agent",
  pass: "Pass",
  target: "Target",
  sleeper: "Watch list",
  rostered: "Rostered",
  mine: "On my team",
  taken: "Taken",
};

export function formatStatusLabel(status) {
  if (!status) return "—";
  return STATUS_LABELS[status] || String(status);
}

export function isRowAvailable(row) {
  if (row?.is_available != null) return Boolean(row.is_available);
  const status = row?.status;
  return status === "available" || status === "pass" || status === "target" || status === "sleeper";
}

export function compareRows(a, b, sortKey, sortDir) {
  const av = sortValue(a, sortKey);
  const bv = sortValue(b, sortKey);
  let cmp = 0;
  if (typeof av === "string" || typeof bv === "string") {
    cmp = String(av).localeCompare(String(bv), undefined, { sensitivity: "base" });
  } else if (av == null && bv == null) {
    cmp = 0;
  } else if (av == null) {
    cmp = 1;
  } else if (bv == null) {
    cmp = -1;
  } else if (av === bv) {
    cmp = String(a.player || "").localeCompare(String(b.player || ""), undefined, { sensitivity: "base" });
  } else {
    cmp = av > bv ? 1 : -1;
  }
  return sortDir === "asc" ? cmp : -cmp;
}

function rowUpsideSkew(row) {
  if (row?.upside_skew != null && Number.isFinite(Number(row.upside_skew))) {
    return Number(row.upside_skew);
  }
  return upsideSkew(row?.season_p10, row?.season_p50 ?? row?.season_proj, row?.season_p90);
}

function sortValue(row, key) {
  switch (key) {
    case "tier":
      return TIER_ORDER[row.tier] ?? 99;
    case "status":
      return STATUS_ORDER[row.status] ?? 99;
    case "player":
    case "team":
    case "position":
      return row[key] || row[key === "player" ? "player_name" : key] || "zzz";
    case "fair_value":
      // When RAAV is populated (risk_tolerance != 0), sort by the displayed bid.
      return row.risk_adjusted_value ?? row.fair_value ?? row.model_bid_hint ?? null;
    case "risk_adjusted_value":
      return row.risk_adjusted_value ?? row.fair_value ?? row.model_bid_hint ?? null;
    case "risk_score":
      return row.risk_score != null && Number.isFinite(Number(row.risk_score))
        ? Number(row.risk_score)
        : null;
    case "min_sal":
      return row.min_sal ?? null;
    case "max_sal":
      return row.max_sal ?? null;
    case "season_spread":
      return row.season_spread ?? null;
    case "season_p10":
      return row.season_p10 ?? null;
    case "season_p50":
      return row.season_p50 ?? row.season_proj ?? null;
    case "season_p90":
      return row.season_p90 ?? null;
    case "pos_rank":
      return row.pos_rank ?? null;
    case "upside_skew":
      return rowUpsideSkew(row);
    default:
      return row[key];
  }
}

function matchesRiskProfile(row, riskProfile) {
  if (!riskProfile || riskProfile === "ALL") return true;
  const skew = rowUpsideSkew(row);
  if (skew == null) return false;
  if (riskProfile === "UPSIDE") return skew >= 1.15;
  if (riskProfile === "FLOOR") return skew <= 0.85;
  return true;
}

export function filterAndSortRows(rows, {
  pool = "all",
  posFilter = "ALL",
  statusFilter = "ALL",
  tierFilter = "ALL",
  riskProfile = "ALL",
  search = "",
  sortKey = "fair_value",
  sortDir = "desc",
}) {
  let list = [...(rows || [])];
  if (pool === "available") {
    list = list.filter(isRowAvailable);
  }
  if (posFilter !== "ALL") {
    list = list.filter((r) => normalizeHubPosition(r.position) === posFilter);
  }
  if (tierFilter !== "ALL") {
    list = list.filter((r) => r.tier === tierFilter);
  }
  if (statusFilter === "AVAILABLE") {
    list = list.filter(isRowAvailable);
  } else if (statusFilter === "TAKEN") {
    list = list.filter((r) => r.status === "taken");
  } else if (statusFilter === "MINE") {
    list = list.filter((r) => r.status === "mine" || r.status === "rostered" || r.status === "sleeper");
  } else if (statusFilter === "SLEEPER") {
    list = list.filter((r) => r.on_sleeper);
  }
  if (riskProfile && riskProfile !== "ALL") {
    list = list.filter((r) => matchesRiskProfile(r, riskProfile));
  }
  if (search.trim()) {
    const q = search.toLowerCase();
    list = list.filter(
      (r) => String(r.player || r.player_name || "").toLowerCase().includes(q)
        || String(r.team || "").toLowerCase().includes(q),
    );
  }
  list.sort((a, b) => compareRows(a, b, sortKey, sortDir));
  return list;
}

export function nextSortState(currentKey, currentDir, clickedKey) {
  if (currentKey === clickedKey) {
    return { sortKey: clickedKey, sortDir: currentDir === "asc" ? "desc" : "asc" };
  }
  const descFirst = [
    "season_proj",
    "per_game_proj",
    "fair_value",
    "risk_adjusted_value",
    "risk_score",
    "min_sal",
    "max_sal",
    "value_delta",
    "season_spread",
    "season_p10",
    "season_p50",
    "season_p90",
    "upside_skew",
  ].includes(clickedKey);
  return { sortKey: clickedKey, sortDir: descFirst ? "desc" : "asc" };
}

export function sortIndicator(sortKey, sortDir, columnKey) {
  if (sortKey !== columnKey) return "↕";
  return sortDir === "asc" ? "↑" : "↓";
}
