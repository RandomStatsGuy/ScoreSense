/** Shared Best ball board presentation (Tools → Best ball). */

export const BB_POSITION_ORDER = ["QB", "RB", "WR/TE"];

export const BB_POSITION_FILTERS = [
  { id: "ALL", label: "All" },
  { id: "QB", label: "QB" },
  { id: "RB", label: "RB" },
  { id: "WR/TE", label: "WR/TE" },
];

export const BB_COVERAGE_FILTERS = [
  { id: "ALL", label: "All" },
  { id: "missing", label: "No ECR" },
  { id: "ranked", label: "With ECR" },
];

export const BB_SORTS = [
  { id: "model", label: "Pos rank", hint: "ScoreSense rank within position" },
  { id: "adp", label: "Pos ECR", hint: "FantasyPros consensus rank within position" },
  { id: "missing", label: "No ECR", hint: "Names FantasyPros has not ranked, then Pos rank" },
];

export const BB_NO_ECR_LABEL = "No ECR";
export const BB_EDGE_THRESHOLD = 10;
export const BB_COL_COUNT = 9;

export const BB_COLUMNS = [
  { id: "index", label: "#", hint: "Place in this filtered list" },
  { id: "player", label: "Player" },
  { id: "pos", label: "Pos" },
  { id: "model", label: "Pos rank", hint: "ScoreSense rank within position" },
  { id: "team", label: "Team" },
  { id: "bye", label: "Bye" },
  { id: "proj", label: "Season proj" },
  { id: "ecr", label: "Pos ECR", hint: "FantasyPros consensus rank within position" },
  { id: "edge", label: "Edge", hint: "Pos ECR minus Pos rank. Plus is a discount." },
];

export function bestBallSorts({ ecrOnly = true, withAdp = 0 } = {}) {
  if (ecrOnly || !withAdp) return BB_SORTS;
  return [
    ...BB_SORTS,
    { id: "edge", label: "Edge", hint: "Pos ECR minus Pos rank. Plus is a discount." },
  ];
}

export function bestBallHeroCopy() {
  return {
    eyebrow: "Tools · Best ball",
    heading: "Take the name ECR is missing.",
    support:
      "Edge is Pos ECR minus Pos rank. A plus is a discount FantasyPros missed; a minus is a reach you pay extra for.",
  };
}

export function bestBallStatusChip({ loading = false, count = 0, withAdp = 0 } = {}) {
  if (loading) return { label: "Building board", tone: "readonly" };
  if (!count) return { label: "No board yet", tone: "readonly" };
  if (!withAdp) return { label: `${count} players · no ECR cached`, tone: "readonly" };
  return { label: `${count} players`, tone: "readonly" };
}

export function bestBallScoringNote() {
  return "Scoring: PPR";
}

export function bestBallEdgeLegendCopy() {
  return "Edge +10 or more is a discount. −10 or more is a reach.";
}

export function bestBallEcrSourceCopy() {
  return "Pos ECR is FantasyPros consensus.";
}

export function bestBallGroupLabel(position, count = 0) {
  return `${position} · ${count}`;
}

/** Number(null) is 0 — treat null/empty as missing instead. */
function asNumber(value) {
  if (value == null || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export function rowHasEcr(row) {
  return asNumber(row?.adp_rank) != null;
}

export function formatRank(value) {
  const num = asNumber(value);
  return num != null ? String(Math.round(num)) : "—";
}

export function formatEcr(value) {
  const num = asNumber(value);
  return num != null ? String(Math.round(num)) : BB_NO_ECR_LABEL;
}

export function formatEdge(value) {
  const num = asNumber(value);
  if (num == null) return "";
  const rounded = Math.round(num);
  if (rounded > 0) return `+${rounded}`;
  return String(rounded);
}

/** Tone for the edge cell: discount = market late, reach = market early. */
export function edgeTone(value) {
  const num = asNumber(value);
  if (num == null) return "";
  if (num >= BB_EDGE_THRESHOLD) return "discount";
  if (num <= -BB_EDGE_THRESHOLD) return "reach";
  return "";
}

export function byeLabel(value) {
  const num = asNumber(value);
  return num != null && num > 0 ? `Wk ${Math.round(num)}` : "—";
}

export function formatSeasonPoints(value) {
  const num = asNumber(value);
  return num != null ? num.toFixed(0) : "—";
}

function rankValue(value) {
  const num = asNumber(value);
  return num != null ? num : Number.POSITIVE_INFINITY;
}

function positionOrder(row) {
  const idx = BB_POSITION_ORDER.indexOf(String(row?.Position || ""));
  return idx >= 0 ? idx : BB_POSITION_ORDER.length;
}

export function sortBoardRows(rows = [], sortId = "model") {
  const list = [...rows];
  if (sortId === "edge") {
    list.sort((a, b) => {
      const aEdge = asNumber(a.value_vs_adp);
      const bEdge = asNumber(b.value_vs_adp);
      const aOk = aEdge != null;
      const bOk = bEdge != null;
      if (aOk && bOk && bEdge !== aEdge) return bEdge - aEdge;
      if (aOk !== bOk) return aOk ? -1 : 1;
      return rankValue(a.model_rank) - rankValue(b.model_rank);
    });
    return list;
  }
  if (sortId === "adp") {
    list.sort((a, b) => {
      const diff = rankValue(a.adp_rank) - rankValue(b.adp_rank);
      return diff !== 0 ? diff : rankValue(a.model_rank) - rankValue(b.model_rank);
    });
    return list;
  }
  if (sortId === "missing") {
    list.sort((a, b) => {
      const aMiss = !rowHasEcr(a);
      const bMiss = !rowHasEcr(b);
      if (aMiss !== bMiss) return aMiss ? -1 : 1;
      const pos = positionOrder(a) - positionOrder(b);
      if (pos !== 0) return pos;
      return rankValue(a.model_rank) - rankValue(b.model_rank);
    });
    return list;
  }
  list.sort((a, b) => {
    const pos = positionOrder(a) - positionOrder(b);
    if (pos !== 0) return pos;
    return rankValue(a.model_rank) - rankValue(b.model_rank);
  });
  return list;
}

export function filterBoardRows(rows = [], { position = "ALL", search = "", coverage = "ALL" } = {}) {
  let list = rows;
  if (position !== "ALL") {
    list = list.filter((row) => String(row.Position || "") === position);
  }
  if (coverage === "missing") {
    list = list.filter((row) => !rowHasEcr(row));
  } else if (coverage === "ranked") {
    list = list.filter((row) => rowHasEcr(row));
  }
  const query = String(search || "").trim().toLowerCase();
  if (query) {
    list = list.filter((row) => String(row.Player || "").toLowerCase().includes(query));
  }
  return list;
}

export function shouldGroupBoard(sortId = "model", positionId = "ALL") {
  return sortId === "model" && positionId === "ALL";
}

export function buildBoardItems(rows = [], { groupByPosition = false } = {}) {
  if (!groupByPosition) {
    return rows.map((row, index) => ({ type: "player", row, index: index + 1 }));
  }
  const items = [];
  let index = 0;
  const consumed = new Set();
  for (const pos of BB_POSITION_ORDER) {
    const group = rows.filter((row) => String(row.Position || "") === pos);
    if (!group.length) continue;
    items.push({ type: "group", position: pos, count: group.length });
    for (const row of group) {
      index += 1;
      items.push({ type: "player", row, index });
      consumed.add(row);
    }
  }
  const leftover = rows.filter((row) => !consumed.has(row));
  if (leftover.length) {
    items.push({ type: "group", position: "Other", count: leftover.length });
    for (const row of leftover) {
      index += 1;
      items.push({ type: "player", row, index });
    }
  }
  return items;
}

export function bestBallSummaryItems({
  count = 0,
  withAdp = 0,
} = {}) {
  return [
    {
      id: "adp",
      label: "With ECR",
      value: count ? `${withAdp} of ${count}` : "—",
      tone: count && !withAdp ? "caution" : undefined,
    },
  ];
}

export function bestBallCsvLines(rows = [], quote = (v) => `"${v}"`) {
  const lines = [
    ["#", "Pos rank", "Player", "Pos", "Team", "Bye", "Season proj", "Pos ECR", "Edge"]
      .map(quote)
      .join(","),
  ];
  rows.forEach((row, index) => {
    lines.push(
      [
        String(index + 1),
        formatRank(row.model_rank),
        row.Player || "",
        row.Position || "",
        row.Team || "",
        byeLabel(row.bye_week),
        formatSeasonPoints(row["Season Proj"]),
        formatEcr(row.adp_rank),
        formatEdge(row.value_vs_adp),
      ]
        .map(quote)
        .join(",")
    );
  });
  return lines;
}

export function bestBallBoardNote() {
  return `${bestBallEcrSourceCopy()} ${bestBallEdgeLegendCopy()}`;
}
