/** Shared Best ball board presentation (Tools → Best ball). */

export const BB_POSITION_FILTERS = [
  { id: "ALL", label: "All" },
  { id: "QB", label: "QB" },
  { id: "RB", label: "RB" },
  { id: "WR/TE", label: "WR/TE" },
];

export const BB_SORTS = [
  { id: "model", label: "Model rank", hint: "ScoreSense season projections, best first" },
  { id: "edge", label: "ADP edge", hint: "Biggest gap between model rank and market ADP" },
  { id: "adp", label: "ADP", hint: "Market draft order (FantasyPros ECR)" },
];

export function bestBallHeroCopy() {
  return {
    eyebrow: "Tools · Best ball",
    heading: "Take the name ADP is missing.",
    support:
      "Positive edge means the model wants him earlier than the room. Reach the other way and you pay extra for a name the board already priced.",
  };
}

export function bestBallStatusChip({ loading = false, count = 0, withAdp = 0 } = {}) {
  if (loading) return { label: "Building board", tone: "readonly" };
  if (!count) return { label: "No board yet", tone: "readonly" };
  if (!withAdp) return { label: `${count} players · no ADP cached`, tone: "readonly" };
  return { label: `${count} players · ${withAdp} with ADP`, tone: "active" };
}

/** Number(null) is 0 — treat null/empty as missing instead. */
function asNumber(value) {
  if (value == null || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export function formatRank(value) {
  const num = asNumber(value);
  return num != null ? String(Math.round(num)) : "—";
}

export function formatEdge(value) {
  const num = asNumber(value);
  if (num == null) return "—";
  const rounded = Math.round(num);
  if (rounded > 0) return `+${rounded}`;
  return String(rounded);
}

/** Tone for the edge cell: positive = market discount, negative = market reach. */
export function edgeTone(value) {
  const num = asNumber(value);
  if (num == null) return "";
  if (num >= 10) return "positive";
  if (num <= -10) return "caution";
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

export function sortBoardRows(rows = [], sortId = "model") {
  const list = [...rows];
  const rank = (value) => {
    const num = asNumber(value);
    return num != null ? num : Number.POSITIVE_INFINITY;
  };
  if (sortId === "edge") {
    list.sort((a, b) => {
      const aEdge = asNumber(a.value_vs_adp);
      const bEdge = asNumber(b.value_vs_adp);
      const aOk = aEdge != null;
      const bOk = bEdge != null;
      if (aOk && bOk && bEdge !== aEdge) return bEdge - aEdge;
      if (aOk !== bOk) return aOk ? -1 : 1;
      return rank(a.model_rank) - rank(b.model_rank);
    });
    return list;
  }
  if (sortId === "adp") {
    list.sort((a, b) => {
      const diff = rank(a.adp_rank) - rank(b.adp_rank);
      return diff !== 0 ? diff : rank(a.model_rank) - rank(b.model_rank);
    });
    return list;
  }
  list.sort((a, b) => rank(a.model_rank) - rank(b.model_rank));
  return list;
}

export function filterBoardRows(rows = [], { position = "ALL", search = "" } = {}) {
  let list = rows;
  if (position !== "ALL") {
    list = list.filter((row) => String(row.Position || "") === position);
  }
  const query = String(search || "").trim().toLowerCase();
  if (query) {
    list = list.filter((row) => String(row.Player || "").toLowerCase().includes(query));
  }
  return list;
}

export function bestBallSummaryItems({
  season,
  count = 0,
  withAdp = 0,
  sortId = "model",
  positionId = "ALL",
  filteredCount = 0,
} = {}) {
  const sort = BB_SORTS.find((entry) => entry.id === sortId);
  const position = BB_POSITION_FILTERS.find((entry) => entry.id === positionId);
  return [
    { id: "season", label: "Season", value: season != null ? String(season) : "—" },
    { id: "players", label: "Players", value: count ? String(count) : "—" },
    {
      id: "adp",
      label: "With ADP",
      value: count ? `${withAdp} of ${count}` : "—",
      tone: count && !withAdp ? "caution" : undefined,
    },
    { id: "sort", label: "Sorted by", value: sort?.label || "Model rank" },
    {
      id: "showing",
      label: "Showing",
      value: `${filteredCount} · ${position?.label || "All"}`,
    },
  ];
}

export function bestBallCsvLines(rows = [], quote = (v) => `"${v}"`) {
  const lines = [
    ["Model rank", "Player", "Team", "Pos", "Bye", "Season proj", "ADP", "Edge"]
      .map(quote)
      .join(","),
  ];
  for (const row of rows) {
    lines.push(
      [
        formatRank(row.model_rank),
        row.Player || "",
        row.Team || "",
        row.Position || "",
        byeLabel(row.bye_week),
        formatSeasonPoints(row["Season Proj"]),
        formatRank(row.adp_rank),
        formatEdge(row.value_vs_adp),
      ]
        .map(quote)
        .join(",")
    );
  }
  return lines;
}

export function bestBallBoardNote({ withAdp = 0, count = 0 } = {}) {
  if (!count) return "";
  if (!withAdp) {
    return "No ADP cache found — showing model ranks only. ADP loads from FantasyPros ECR when configured.";
  }
  return "ADP is FantasyPros week-1 ECR when cached. Edge = ADP minus model rank.";
}
