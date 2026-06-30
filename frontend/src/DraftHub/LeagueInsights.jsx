import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { apiFetch } from "../auth";
import { connectionErrorMessage, formatRelativeTime, parseApiError } from "../format";
import useMobileLayout from "../useMobileLayout";
import MobileDataList, { MobileStat } from "../MobileDataList";
import MobilePlayerCard from "../MobilePlayerCard";
import DraftRecapPanel from "./DraftRecapPanel";
import LeagueContractHistory from "./LeagueContractHistory";
import { HubPage, HubSegmentNav, HubFilterChip, HubFilterGroup, HubFilterScroll } from "./HubUILayout";
import {
  INSIGHTS_TAB_SECTIONS,
  mergeInsightsPayload,
  resolveAnalyticsPositions,
} from "./insights/useInsightsData";
import { sortIndicator } from "./valueSheetUtils";
import PlayerCell, { usePlayerMedia } from "../PlayerCell";

const POS_COLORS = {
  QB: "#6366f1",
  RB: "#22c55e",
  WR: "#f59e0b",
  TE: "#ec4899",
  K: "#a855f7",
  DEF: "#64748b",
};

const DEFAULT_POSITIONS = ["QB", "RB", "WR", "TE"];

const SCORING_LINE_COLORS = [
  "#6366f1", "#22c55e", "#f59e0b", "#ec4899", "#a855f7", "#64748b", "#14b8a6", "#f97316",
  "#0ea5e9", "#84cc16", "#e11d48", "#8b5cf6",
];

const SCORING_LINE_DASHES = [
  undefined,
  "6 4",
  "2 4",
  "8 4 2 4",
  "4 2",
  "10 5",
  "2 2",
  "6 2 2 2",
  "4 4",
  "1 3",
  "5 3",
  "3 3",
];

function fmtSal(v) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return `$${Number(v).toFixed(0)}`;
}

function fmtPct(v) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return `${Number(v).toFixed(1)}%`;
}

function playerTradeLabel(p) {
  const sal = p.salary != null ? fmtSal(p.salary) : null;
  const tv = p.trade_value != null ? fmtSal(p.trade_value) : null;
  if (sal && tv && sal !== tv) return `${p.player_name} (${sal} cap · ${tv} value)`;
  return `${p.player_name} (${tv || sal || "—"})`;
}

function Chip({ label, tone }) {
  return <span className={`hub-insights-chip hub-insights-chip-${tone}`}>{label}</span>;
}

function historySeasonLabel(mode, year) {
  if (mode === "all") return "All time";
  if (mode === "year" && year) return `${year} season`;
  return "Current roster";
}

function InsightsSeasonBar({ value, seasons, historic, onChange, disabled, label = "View", className = "" }) {
  const options = [{ id: "current", label: "Current roster" }];
  if (historic?.available) {
    (seasons || []).slice().sort((a, b) => b - a).forEach((yr) => {
      options.push({ id: String(yr), label: String(yr) });
    });
    options.push({ id: "all", label: "All time" });
  }
  return (
    <div className={`hub-insights-season-bar${className ? ` ${className}` : ""}`}>
      <span className="hub-filter-label">{label}</span>
      <HubFilterScroll>
        {options.map((opt) => (
          <HubFilterChip
            key={opt.id}
            active={value === opt.id}
            onClick={() => onChange(opt.id)}
            disabled={disabled}
          >
            {opt.label}
          </HubFilterChip>
        ))}
      </HubFilterScroll>
      {historic?.available && historic?.league_avg_contract != null && value !== "current" && (
        <span className="hub-insights-season-meta">
          League avg contract {fmtSal(historic.league_avg_contract)}
        </span>
      )}
    </div>
  );
}

function InsightsProgress({ active }) {
  if (!active) return null;
  return <div className="hub-insights-progress hub-insights-progress--active" aria-hidden />;
}

function InsightsSkeleton() {
  return (
    <div className="hub-insights-skeleton" aria-busy="true" aria-label="Loading insights">
      <div className="hub-insights-skeleton-block hub-insights-skeleton-block--head" />
      <div className="hub-insights-skeleton-row">
        <div className="hub-insights-skeleton-block hub-insights-skeleton-block--chart" />
        <div className="hub-insights-skeleton-block hub-insights-skeleton-block--chart" />
      </div>
      <div className="hub-insights-skeleton-block hub-insights-skeleton-block--table" />
    </div>
  );
}

const AWARD_EMOJI = {
  highest_paid: "👑",
  most_overpaid: "🔥",
  worst_contract: "💀",
  best_bargain: "💎",
  waiver_king: "🛒",
  cap_hog: "🦣",
  payroll_king: "🏦",
  dead_cap_disaster: "⚰️",
  nomad: "✈️",
  loyalty: "💍",
  career_earnings: "🤑",
  biggest_raise: "📈",
  cap_crunch: "😬",
  points_king: "👑",
  basement: "🕳️",
  weekly_nuke: "💥",
  weekly_disaster: "📉",
  steady_eddie: "🎯",
  rollercoaster: "🎢",
  wire_to_wire: "📡",
  cap_efficiency_goat: "🐐",
  cap_efficiency_fraud: "🎭",
  margin_massacre: "☢️",
  nail_biter: "📸",
  always_runner_up: "🥈",
  floor_collapse: "🌗",
  participation_trophy: "🎖️",
};

function managerLabel(award, ownerMap, yearSpecific) {
  if (award?.display_name) return award.display_name;
  const team = award?.team_name || "";
  const owner = award?.owner_name
    || (team && ownerMap ? (ownerMap[team] || ownerMap[team.toLowerCase()]) : null)
    || "";
  if (!team && owner) return owner;
  if (!owner || owner.toLowerCase() === team.toLowerCase()) return team || owner;
  if (yearSpecific) return `${owner} · ${team}`;
  return owner;
}

function teamDisplayName(row, ownerMap, yearSpecific) {
  if (row?.display_name) return row.display_name;
  const team = row?.team_name || row?.name || "";
  const owner = row?.owner_name
    || (team && ownerMap ? (ownerMap[team] || ownerMap[team.toLowerCase()]) : null)
    || "";
  if (!team) return owner || "—";
  if (!owner || owner.toLowerCase() === team.toLowerCase()) return team;
  if (yearSpecific) return `${owner} · ${team}`;
  return owner;
}

function SortTh({ label, col, sortKey, sortDir, onSort, className = "" }) {
  return (
    <th
      className={`sortable-header ${className}`.trim()}
      onClick={() => onSort(col)}
    >
      {label}
      <span className="sort-indicator"> {sortIndicator(sortKey, sortDir, col)}</span>
    </th>
  );
}

function InsightsTableToolbar({ search, onSearchChange, placeholder, count, total }) {
  return (
    <div className="hub-insights-table-toolbar">
      <input
        type="search"
        className="search-input hub-insights-table-search"
        placeholder={placeholder}
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
      />
      <span className="table-meta hub-insights-table-count">
        {count === total ? `${count} teams` : `${count} of ${total} teams`}
      </span>
    </div>
  );
}

const AWARD_GROUP_META = {
  good: { label: "Best of", className: "hub-spend-awards-label--good" },
  bad: { label: "Worst of", className: "hub-spend-awards-label--bad" },
  other: { label: "Notable", className: "" },
};

function InsightsAwardsPanel({
  awards,
  scopeLabel,
  title = "Cap awards",
  subtitle = "Season highlights",
  ownerMap,
  yearSpecific = false,
  expanded,
  onToggleExpanded,
  visibleGroups,
  onToggleGroup,
}) {
  if (!awards?.length) return null;
  const shame = awards.filter((a) => a.tone === "bad");
  const fame = awards.filter((a) => a.tone === "good" || a.tone === "gold");
  const other = awards.filter((a) => !["bad", "good", "gold"].includes(a.tone));
  const groups = [
    { key: "good", items: fame },
    { key: "bad", items: shame },
    { key: "other", items: other },
  ].filter((g) => g.items.length > 0);

  const visibleCount = groups.reduce(
    (n, g) => n + (visibleGroups[g.key] ? g.items.length : 0),
    0,
  );

  return (
    <section className={`hub-spend-awards${expanded ? "" : " hub-spend-awards--collapsed"}`}>
      <div className="hub-spend-awards-head hub-spend-awards-head--row">
        <div>
          <h3 className="hub-panel-subtitle">{title}</h3>
          <p className="hub-spend-awards-sub">{subtitle} · {scopeLabel}</p>
        </div>
        <button
          type="button"
          className="btn-ghost btn-sm hub-spend-awards-toggle"
          onClick={onToggleExpanded}
          aria-expanded={expanded}
        >
          {expanded ? "Hide awards" : `Show awards (${awards.length})`}
        </button>
      </div>
      {expanded && (
        <>
          <div className="hub-spend-awards-toggles">
            <span className="hub-filter-label">Show</span>
            <HubFilterScroll>
              {groups.map(({ key, items }) => (
                <HubFilterChip
                  key={key}
                  active={visibleGroups[key]}
                  onClick={() => onToggleGroup(key)}
                >
                  {AWARD_GROUP_META[key].label} ({items.length})
                </HubFilterChip>
              ))}
            </HubFilterScroll>
            {visibleCount === 0 && (
              <span className="table-meta">Select at least one group</span>
            )}
          </div>
          {groups.map(({ key, items }) => (
            visibleGroups[key] ? (
              <div className="hub-spend-awards-block" key={key}>
                <span className={`hub-spend-awards-label ${AWARD_GROUP_META[key].className}`.trim()}>
                  {AWARD_GROUP_META[key].label}
                </span>
                <div className="hub-spend-awards-grid">
                  {items.map((award) => (
                    <InsightsAwardCard
                      key={award.id}
                      award={award}
                      ownerMap={ownerMap}
                      yearSpecific={yearSpecific}
                    />
                  ))}
                </div>
              </div>
            ) : null
          ))}
        </>
      )}
    </section>
  );
}

function InsightsAwardCard({ award, ownerMap, yearSpecific }) {
  const emoji = AWARD_EMOJI[award.id] || "🏷️";
  const who = managerLabel(award, ownerMap, yearSpecific);
  return (
    <article className={`hub-spend-award hub-spend-award--${award.tone || "neutral"}`}>
      <div className="hub-spend-award-glow" aria-hidden />
      <div className="hub-spend-award-top">
        <span className="hub-spend-award-emoji" aria-hidden>{emoji}</span>
        <span className="hub-spend-award-title">{award.title}</span>
      </div>
      <strong className="hub-spend-award-headline">{award.headline}</strong>
      {award.roast && <p className="hub-spend-award-roast">{award.roast}</p>}
      {(award.player_name || who) && (
        <p className="hub-spend-award-who">
          {award.player_name && <span className="hub-spend-award-player">{award.player_name}</span>}
          {award.player_name && who && <span className="hub-spend-award-sep">·</span>}
          {who && <span className="hub-spend-award-team">{who}</span>}
          {award.position && <span className="hub-spend-award-pos">{award.position}</span>}
        </p>
      )}
      {award.detail && <p className="hub-spend-award-detail">{award.detail}</p>}
    </article>
  );
}

function insightsNextSort(currentKey, currentDir, clickedKey) {
  const descFirst = new Set([
    "committed",
    "unspent",
    "total_points",
    "avg_points",
    "weeks_scored",
    "points_per_dollar",
    "efficiency_rank",
    "vs_league_avg_pct",
    "top_position_spend",
  ]);
  if (String(clickedKey).startsWith("spend_")) descFirst.add(clickedKey);
  if (currentKey === clickedKey) {
    return { sortKey: clickedKey, sortDir: currentDir === "asc" ? "desc" : "asc" };
  }
  const sortDir = clickedKey === "team" || !descFirst.has(clickedKey) ? "asc" : "desc";
  return { sortKey: clickedKey, sortDir };
}

function filterSortTeams(rows, {
  filter,
  sortKey,
  sortDir,
  ownerMap,
  yearSpecific,
  getLabel = (t) => teamDisplayName(t, ownerMap, yearSpecific),
  getters = {},
}) {
  const q = filter.trim().toLowerCase();
  let list = rows;
  if (q) {
    list = list.filter((t) => {
      const label = getLabel(t).toLowerCase();
      const raw = String(t.team_name || t.name || "").toLowerCase();
      return label.includes(q) || raw.includes(q);
    });
  }
  const dir = sortDir === "asc" ? 1 : -1;
  const defaultGet = (t, key) => {
    if (getters[key]) return getters[key](t);
    if (key === "team") return getLabel(t).toLowerCase();
    return t[key];
  };
  return [...list].sort((a, b) => {
    const av = defaultGet(a, sortKey);
    const bv = defaultGet(b, sortKey);
    if (typeof av === "string" && typeof bv === "string") {
      return av.localeCompare(bv) * dir;
    }
    return ((Number(av) || 0) - (Number(bv) || 0)) * dir;
  });
}

function InsightsCrimeReportPlaceholder({ title, subtitle, scopeLabel, message }) {
  return (
    <section className="hub-spend-awards hub-spend-awards--empty">
      <div className="hub-spend-awards-head">
        <div>
          <h3 className="hub-panel-subtitle">{title}</h3>
          <p className="hub-spend-awards-sub">{subtitle} · {scopeLabel}</p>
        </div>
      </div>
      <p className="chart-note hub-insights-callout">{message}</p>
    </section>
  );
}

function PlayerHistoryStat({ label, value, hint }) {
  return (
    <div className="hub-player-history-stat">
      <span className="hub-player-history-stat-label">{label}</span>
      <strong className="hub-player-history-stat-value">{value}</strong>
      {hint && <span className="hub-player-history-stat-hint">{hint}</span>}
    </div>
  );
}

function PlayerHistoryTimeline({ events }) {
  if (!events.length) {
    return <p className="chart-note">No ownership history recorded for this view.</p>;
  }
  return (
    <ol className="hub-player-history-timeline">
      {events.map((ev, idx) => {
        const type = ev.event_type || "event";
        let title = type;
        let detail = ev.team_name || "—";
        if (type === "contract") {
          title = `${ev.season} contract`;
          detail = `${ev.team_name} · ${fmtSal(ev.amount)}`;
          if (ev.contract_phase) detail += ` · ${ev.contract_phase}`;
        } else if (type === "season_roster") {
          title = `${ev.season} season`;
        } else if (type === "roster") {
          title = "On roster";
          detail = `${ev.team_name}${ev.amount != null && ev.amount > 0 ? ` · ${fmtSal(ev.amount)}/yr` : ""}`;
        } else if (type === "acquired") {
          title = "Won at auction";
          detail = `${ev.team_name} for ${fmtSal(ev.amount)}`;
        } else if (type === "cut") {
          title = "Dropped";
          detail = `${ev.team_name}${ev.refund != null ? ` · refund ${fmtSal(ev.refund)}` : ""}`;
        }
        return (
          <li key={idx} className={`hub-player-history-event hub-player-history-event--${type}`}>
            <div className="hub-player-history-event-head">
              <span className="hub-player-history-event-type">{title}</span>
              {ev.at && <span className="table-meta">{new Date(ev.at).toLocaleDateString()}</span>}
            </div>
            <div className="hub-player-history-event-body">{detail}</div>
            {ev.note && type !== "contract" && <span className="table-meta">{ev.note}</span>}
          </li>
        );
      })}
    </ol>
  );
}

function metricValue(team, pos, mode) {
  if (mode === "pct") return team.pct_by_position?.[pos] ?? 0;
  return team.spend_by_position?.[pos] ?? 0;
}

function formatMetric(v, mode) {
  return mode === "pct" ? fmtPct(v) : fmtSal(v);
}

function ScoringEmptyState({ scoring, hubContext, onNavigate, onRefresh }) {
  const reason = scoring?.reason || "unknown";
  const linked = Boolean(
    hubContext?.sleeper_league_id || scoring?.sleeper_league_id,
  );

  let title = "Connect Sleeper for scoring";
  let body = scoring?.hint
    || "Link Sleeper in Setup for scoring.";

  if (reason === "no_matchups" || (linked && reason !== "fetch_failed")) {
    title = "Waiting for scored games";
    body = scoring?.hint
      || "No scored weeks yet.";
  } else if (reason === "fetch_failed") {
    title = "Could not load Sleeper scoring";
  }

  return (
    <div className="hub-insights-empty-state">
      <h3>{title}</h3>
      <p>{body}</p>
      {linked && (
        <p className="chart-note hub-insights-empty-meta">
          Sleeper league linked
          {scoring?.season ? ` · ${scoring.season} season` : ""}
          {scoring?.status ? ` · ${scoring.status}` : ""}
        </p>
      )}
      <div className="hub-insights-empty-actions">
        {!linked && onNavigate && (
          <button type="button" className="btn-primary btn-sm" onClick={() => onNavigate("setup")}>
            Go to Setup
          </button>
        )}
        {!linked && onNavigate && (
          <button type="button" className="btn-ghost btn-sm" onClick={() => onNavigate("league-rosters")}>
            All teams
          </button>
        )}
        {onRefresh && (
          <button type="button" className="btn-ghost btn-sm" onClick={onRefresh}>
            Refresh
          </button>
        )}
      </div>
    </div>
  );
}

function normalizeOwnershipPayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (Array.isArray(payload.players)) return payload;
  if (payload.ownership && Array.isArray(payload.ownership.players)) return payload.ownership;
  return null;
}

function pickOwnershipBlock(fresh, insightsPayload) {
  const fromFresh = normalizeOwnershipPayload(fresh);
  const fromInsights = normalizeOwnershipPayload(insightsPayload);
  if (fromFresh?.players?.length) return fromFresh;
  return fromInsights;
}

function resolveDefaultTeamPick(teams, hubContext) {
  if (!teams?.length) return "";
  const mine = teams.find((t) => t.team_id === hubContext?.team_id);
  if (mine) return String(mine.team_id);
  const byName = teams.find((t) => t.team_name === hubContext?.team_name);
  if (byName) return String(byName.team_id);
  return String(teams[0].team_id);
}

const INSIGHTS_TABS = [
  { id: "cap", label: "Spend" },
  { id: "scoring", label: "Scoring" },
  { id: "ownership", label: "History" },
  { id: "contracts", label: "Contracts" },
  { id: "trades", label: "Trades" },
];

function insightsLoadCacheKey(tab, opts, refs) {
  if (tab === "scoring") {
    const s = opts.scoringSeason ?? refs.scoringSeasonRef.current ?? "current";
    return `scoring:${s}`;
  }
  if (tab === "cap") {
    const h = opts.capSeason ?? refs.capSeasonRef.current ?? "current";
    return `cap:${h}`;
  }
  if (tab === "trades") return "trades";
  return tab;
}

export default function LeagueInsights({
  leagueId,
  hubContext,
  onNavigate,
  activeTab: activeTabProp,
  onActiveTabChange,
}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tabLoading, setTabLoading] = useState(false);
  const [error, setError] = useState("");
  const [teamPick, setTeamPick] = useState("");
  const [expandedPartner, setExpandedPartner] = useState("");
  const [applying, setApplying] = useState("");
  const [msg, setMsg] = useState("");
  const [activeTabLocal, setActiveTabLocal] = useState("cap");
  const activeTab = activeTabProp || activeTabLocal;
  const setActiveTab = useCallback(
    (tab) => {
      if (onActiveTabChange) onActiveTabChange(tab);
      else setActiveTabLocal(tab);
    },
    [onActiveTabChange],
  );

  useEffect(() => {
    if (activeTabProp) setActiveTabLocal(activeTabProp);
  }, [activeTabProp]);
  const [spendMetric, setSpendMetric] = useState("dollars");
  const [visiblePositions, setVisiblePositions] = useState(() => new Set(DEFAULT_POSITIONS));
  const [playerSearch, setPlayerSearch] = useState("");
  const [selectedPlayerId, setSelectedPlayerId] = useState("");
  const [ownershipData, setOwnershipData] = useState(null);
  const [ownershipLoading, setOwnershipLoading] = useState(false);
  const [ownershipSeasonLoading, setOwnershipSeasonLoading] = useState(false);
  const [ownershipError, setOwnershipError] = useState("");
  const [scoringSeason, setScoringSeason] = useState("current");
  const [capSeason, setCapSeason] = useState("current");
  const [historySeason, setHistorySeason] = useState("current");
  const [chartHiddenTeams, setChartHiddenTeams] = useState(() => new Set());
  const [chartHoveredTeam, setChartHoveredTeam] = useState("");
  const [capAwardsExpanded, setCapAwardsExpanded] = useState(false);
  const [scoringAwardsExpanded, setScoringAwardsExpanded] = useState(false);
  const [awardGroupToggles, setAwardGroupToggles] = useState({
    good: true,
    bad: true,
    other: true,
  });
  const [capTeamFilter, setCapTeamFilter] = useState("");
  const [capSortKey, setCapSortKey] = useState("committed");
  const [capSortDir, setCapSortDir] = useState("desc");
  const [capEffSortKey, setCapEffSortKey] = useState("efficiency_rank");
  const [capEffSortDir, setCapEffSortDir] = useState("asc");
  const [scoringTeamFilter, setScoringTeamFilter] = useState("");
  const [scoringSortKey, setScoringSortKey] = useState("total_points");
  const [scoringSortDir, setScoringSortDir] = useState("desc");
  const [scoringEffSortKey, setScoringEffSortKey] = useState("efficiency_rank");
  const [scoringEffSortDir, setScoringEffSortDir] = useState("asc");
  const mobileLayout = useMobileLayout();
  const chartBottomMargin = mobileLayout ? 48 : 4;
  const chartXTick = mobileLayout
    ? { fontSize: 10, angle: -35, textAnchor: "end" }
    : { fontSize: 11 };
  const prevTabRef = React.useRef("cap");
  const activeTabRef = React.useRef(activeTab);
  const latestScoringSeasonRef = React.useRef("");
  const loadGenerationRef = React.useRef(0);
  const loadCacheRef = React.useRef(new Map());
  const scoringPrefetchRef = React.useRef(false);
  const dataRef = React.useRef(null);
  const capSeasonRef = React.useRef(capSeason);
  const historySeasonRef = React.useRef(historySeason);
  const scoringSeasonRef = React.useRef(scoringSeason);
  const hubContextRef = React.useRef(hubContext);
  activeTabRef.current = activeTab;
  capSeasonRef.current = capSeason;
  historySeasonRef.current = historySeason;
  scoringSeasonRef.current = scoringSeason;
  hubContextRef.current = hubContext;
  dataRef.current = data;

  const resolveHistorySeason = useCallback((tab, opts = {}) => {
    const active = opts.activeTab ?? tab;
    if (active === "cap") return opts.capSeason ?? capSeasonRef.current;
    if (active === "scoring") return opts.scoringSeason ?? scoringSeasonRef.current ?? "current";
    if (active === "ownership" || active === "contracts") return opts.historySeason ?? historySeasonRef.current;
    return "current";
  }, []);

  const load = useCallback(async (opts = {}) => {
    if (!leagueId) return;
    const tab = opts.activeTab ?? activeTabRef.current;
    const sections = opts.sections ?? INSIGHTS_TAB_SECTIONS[tab];
    const cacheKey = sections ? insightsLoadCacheKey(tab, opts, {
      capSeasonRef,
      scoringSeasonRef,
    }) : null;

    if (!opts.refresh && cacheKey && loadCacheRef.current.has(cacheKey)) {
      const cached = loadCacheRef.current.get(cacheKey);
      setData((prev) => mergeInsightsPayload(prev || {}, cached, { sections }));
      if (!sections || sections.includes("cap")) {
        setVisiblePositions(new Set(resolveAnalyticsPositions(cached.analytics)));
      }
      setLoading(false);
      setTabLoading(false);
      return;
    }

    const generation = ++loadGenerationRef.current;
    const background = Boolean(opts.background || (opts.merge && dataRef.current));
    if (background) setTabLoading(true);
    else setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (opts.refresh) params.set("refresh", "1");
      const hist = resolveHistorySeason(tab, opts);
      if (hist && hist !== "current") params.set("history_season", String(hist));
      const season = opts.scoringSeason ?? scoringSeasonRef.current ?? latestScoringSeasonRef.current ?? "current";
      if (tab === "scoring" && season && season !== "current") {
        params.set("scoring_season", String(season));
        if (season !== "all" && /^\d+$/.test(String(season))) {
          params.set("cap_efficiency_season", String(season));
        }
      }
      if (sections) params.set("sections", sections);
      const q = params.toString() ? `?${params.toString()}` : "";
      const res = await apiFetch(`/api/hub/league/${encodeURIComponent(leagueId)}/insights${q}`);
      if (!res.ok) throw new Error(await parseApiError(res));
      const payload = await res.json();
      if (generation !== loadGenerationRef.current) return;
      if (cacheKey) loadCacheRef.current.set(cacheKey, payload);
      setData((prev) => (opts.merge ? mergeInsightsPayload(prev, payload, { sections }) : payload));
      if (!sections || sections.includes("cap")) {
        setVisiblePositions(new Set(resolveAnalyticsPositions(payload.analytics)));
      }
      const seasonLabel = payload.scoring?.requested_season || payload.scoring?.season;
      if (seasonLabel && seasonLabel !== "all") {
        latestScoringSeasonRef.current = String(seasonLabel);
      }
      if (seasonLabel && !opts.keepSeason && tab !== "cap") {
        setScoringSeason(String(seasonLabel));
      }
      if (!opts.keepChartHidden) {
        setChartHiddenTeams(new Set());
      }
      const teams = payload.analytics?.teams || [];
      if (teams.length) {
        setTeamPick((prev) => {
          const stillValid = teams.some(
            (t) => String(t.team_id) === String(prev) || String(t.team_name) === String(prev),
          );
          if (stillValid && prev) return prev;
          return resolveDefaultTeamPick(teams, hubContextRef.current);
        });
      }
    } catch (e) {
      const msg = connectionErrorMessage(e);
      setError(/internal server error|500/i.test(msg)
        ? "Insights failed to load. Try again or switch tabs — if it persists, restart the API."
        : msg);
    } finally {
      if (background) setTabLoading(false);
      else setLoading(false);
    }
  }, [leagueId, resolveHistorySeason]);

  useEffect(() => {
    if (!data?.analytics?.teams?.length || visiblePositions.size > 0) return;
    setVisiblePositions(new Set(resolveAnalyticsPositions(data.analytics)));
  }, [data?.analytics, visiblePositions.size]);

  useEffect(() => {
    if (!leagueId) return;
    loadCacheRef.current.clear();
    scoringPrefetchRef.current = false;
    load({ activeTab: "cap", sections: "cap" });
  }, [leagueId, load]);

  useEffect(() => {
    if (!leagueId || !data?.analytics?.teams?.length) return;
    if (data?.scoring?.available) return;
    if (scoringPrefetchRef.current) return;
    scoringPrefetchRef.current = true;
    load({
      sections: "scoring",
      merge: true,
      keepSeason: true,
      keepChartHidden: true,
      background: true,
      activeTab: "scoring",
    });
  }, [leagueId, data?.analytics?.teams?.length, data?.scoring?.available, load]);

  const loadOwnershipHistory = useCallback(async (opts = {}) => {
    if (!leagueId) return null;
    const isSeasonRefresh = Boolean(opts.refresh);
    if (isSeasonRefresh) {
      setOwnershipSeasonLoading(true);
    } else {
      setOwnershipLoading(true);
    }
    setOwnershipError("");
    try {
      const params = new URLSearchParams({ ownership_only: "1" });
      if (isSeasonRefresh) params.set("refresh", "1");
      if (historySeason && historySeason !== "current") {
        params.set("history_season", String(historySeason));
      }
      const q = `?${params.toString()}`;
      let res = await apiFetch(
        `/api/hub/league/${encodeURIComponent(leagueId)}/insights${q}`,
      );
      if (res.status === 404) {
        const legacy = new URLSearchParams();
        if (isSeasonRefresh) legacy.set("refresh", "1");
        const legacyQ = legacy.toString() ? `?${legacy.toString()}` : "";
        res = await apiFetch(
          `/api/hub/league/${encodeURIComponent(leagueId)}/ownership-history${legacyQ}`,
        );
      }
      if (!res.ok) throw new Error(await parseApiError(res));
      const payload = await res.json();
      const normalized = normalizeOwnershipPayload(payload);
      if (normalized) {
        setOwnershipData(normalized);
        if (!opts.keepSelection) {
          setSelectedPlayerId((prev) => prev || normalized.players?.[0]?.player_id || "");
        }
      }
      return normalized;
    } catch (e) {
      setOwnershipError(connectionErrorMessage(e));
      return null;
    } finally {
      if (isSeasonRefresh) {
        setOwnershipSeasonLoading(false);
      } else {
        setOwnershipLoading(false);
      }
    }
  }, [leagueId, historySeason]);

  const ownership = useMemo(
    () => pickOwnershipBlock(ownershipData, data),
    [ownershipData, data],
  );

  useEffect(() => {
    if (prevTabRef.current === activeTab) return;
    prevTabRef.current = activeTab;
    if (activeTab === "ownership" || activeTab === "contracts") return;
    const sections = INSIGHTS_TAB_SECTIONS[activeTab];
    if (!sections) return;
    const season = scoringSeasonRef.current || latestScoringSeasonRef.current;
    load({
      activeTab,
      sections,
      merge: true,
      keepSeason: true,
      keepChartHidden: true,
      ...(activeTab === "scoring" ? { scoringSeason: scoringSeasonRef.current } : {}),
      ...(activeTab === "cap" ? { capSeason: capSeasonRef.current } : {}),
    });
  }, [activeTab, load]);

  useEffect(() => {
    if (activeTab !== "ownership" || !leagueId) return;
    loadOwnershipHistory({ keepSelection: true });
  }, [activeTab, leagueId, historySeason, loadOwnershipHistory]);

  const toggleAwardGroup = useCallback((key) => {
    setAwardGroupToggles((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const onCapSort = useCallback((col) => {
    const next = insightsNextSort(capSortKey, capSortDir, col);
    setCapSortKey(next.sortKey);
    setCapSortDir(next.sortDir);
  }, [capSortKey, capSortDir]);

  const onCapEffSort = useCallback((col) => {
    const next = insightsNextSort(capEffSortKey, capEffSortDir, col);
    setCapEffSortKey(next.sortKey);
    setCapEffSortDir(next.sortDir);
  }, [capEffSortKey, capEffSortDir]);

  const onScoringSort = useCallback((col) => {
    const next = insightsNextSort(scoringSortKey, scoringSortDir, col);
    setScoringSortKey(next.sortKey);
    setScoringSortDir(next.sortDir);
  }, [scoringSortKey, scoringSortDir]);

  const onScoringEffSort = useCallback((col) => {
    const next = insightsNextSort(scoringEffSortKey, scoringEffSortDir, col);
    setScoringEffSortKey(next.sortKey);
    setScoringEffSortDir(next.sortDir);
  }, [scoringEffSortKey, scoringEffSortDir]);

  const positions = useMemo(
    () => resolveAnalyticsPositions(data?.analytics),
    [data],
  );

  const activePositions = useMemo(
    () => positions.filter((p) => visiblePositions.has(p)),
    [positions, visiblePositions],
  );

  const barData = useMemo(() => {
    const teams = data?.analytics?.teams || [];
    const mode = spendMetric === "pct" ? "pct" : "dollars";
    const yearSpecific = capSeason === "all" ? false : capSeason !== "current" && /^\d+$/.test(String(capSeason));
    const owners = data?.owner_map || {};
    return teams.map((t) => {
      const row = {
        name: t.display_name || teamDisplayName(t, owners, yearSpecific),
        unspent: mode === "pct" ? t.pct_unspent : t.unspent,
      };
      for (const p of activePositions) {
        row[p] = metricValue(t, p, mode === "pct" ? "pct" : "dollars");
      }
      return row;
    });
  }, [data, activePositions, spendMetric, capSeason]);

  const pieData = useMemo(() => {
    const teams = data?.analytics?.teams || [];
    const team = teams.find(
      (t) => String(t.team_id) === String(teamPick) || String(t.team_name) === String(teamPick),
    );
    if (!team) return [];
    const mode = spendMetric === "pct" ? "pct" : "dollars";
    const slices = activePositions.map((p) => ({
      name: p,
      value: metricValue(team, p, mode === "pct" ? "pct" : "dollars"),
      fill: POS_COLORS[p] || "#94a3b8",
    })).filter((s) => s.value > 0);
    const dead = mode === "pct" ? team.pct_dead_cap : team.dead_cap;
    if (dead > 0) slices.push({ name: "Dead cap", value: dead, fill: "#ef4444" });
    return slices;
  }, [data, teamPick, activePositions, spendMetric]);

  const scoringLineData = useMemo(() => {
    const weeks = data?.scoring?.weeks || [];
    const teams = new Set();
    weeks.forEach((w) => (w.teams || []).forEach((t) => teams.add(t.team_name)));
    return weeks.map((w) => {
      const row = { week: `W${w.week}` };
      (w.teams || []).forEach((t) => {
        row[t.team_name] = t.points;
      });
      return row;
    });
  }, [data]);

  const allScoringTeams = useMemo(() => {
    const names = new Set();
    (data?.scoring?.weeks || []).forEach((w) => (w.teams || []).forEach((t) => names.add(t.team_name)));
    (data?.scoring?.standings || []).forEach((t) => t.team_name && names.add(t.team_name));
    return [...names].sort();
  }, [data]);

  const chartVisibleTeams = useMemo(() => {
    if (!chartHiddenTeams.size) return allScoringTeams;
    return allScoringTeams.filter((n) => !chartHiddenTeams.has(n));
  }, [allScoringTeams, chartHiddenTeams]);

  const scoringColorByTeam = useMemo(() => {
    const map = {};
    allScoringTeams.forEach((name, i) => {
      map[name] = SCORING_LINE_COLORS[i % SCORING_LINE_COLORS.length];
    });
    return map;
  }, [allScoringTeams]);

  const scoringDashByTeam = useMemo(() => {
    const map = {};
    allScoringTeams.forEach((name, i) => {
      map[name] = SCORING_LINE_DASHES[i % SCORING_LINE_DASHES.length];
    });
    return map;
  }, [allScoringTeams]);

  const toggleChartTeam = (teamName) => {
    setChartHiddenTeams((prev) => {
      const next = new Set(prev);
      if (next.has(teamName)) next.delete(teamName);
      else next.add(teamName);
      return next;
    });
  };

  const handleLegendClick = useCallback((entry) => {
    const name = entry?.value;
    if (name) toggleChartTeam(name);
  }, []);

  const tradePlayerIds = useMemo(() => {
    const ids = new Set();
    (data?.trade?.suggestions || []).forEach((s) => {
      (s.send || []).forEach((p) => p.player_id && ids.add(p.player_id));
      (s.receive || []).forEach((p) => p.player_id && ids.add(p.player_id));
    });
    return [...ids];
  }, [data]);
  const tradePlayerIdsForMedia = activeTab === "trades" ? tradePlayerIds : [];
  const tradeMedia = usePlayerMedia(tradePlayerIdsForMedia);

  const ownershipPlayerIds = useMemo(() => {
    const ids = new Set();
    (ownership?.players || []).slice(0, 80).forEach((p) => p.player_id && ids.add(p.player_id));
    if (selectedPlayerId) ids.add(selectedPlayerId);
    return [...ids];
  }, [ownership, selectedPlayerId]);
  const ownershipPlayerIdsForMedia = activeTab === "ownership" ? ownershipPlayerIds : [];
  const ownershipMedia = usePlayerMedia(ownershipPlayerIdsForMedia);

  const filteredPlayers = useMemo(() => {
    const q = playerSearch.trim().toLowerCase();
    const list = (ownership?.players || []).filter((p) => {
      const name = String(p.player_name || "");
      if (!name || name.length > 32) return false;
      if (/\d{2,}/.test(name)) return false;
      return true;
    });
    const sorted = [...list].sort((a, b) => {
      const av = a.contract_stats?.avg_cap;
      const bv = b.contract_stats?.avg_cap;
      if (av != null && bv != null && av !== bv) return bv - av;
      return String(a.player_name || "").localeCompare(String(b.player_name || ""));
    });
    const limit = historySeason === "current" ? 80 : 120;
    if (!q) return sorted.slice(0, limit);
    return sorted.filter(
      (p) => String(p.player_name || "").toLowerCase().includes(q)
        || String(p.player_id || "").includes(q),
    ).slice(0, 60);
  }, [ownership, playerSearch, historySeason]);

  const selectedPlayer = useMemo(
    () => (ownership?.players || []).find((p) => p.player_id === selectedPlayerId),
    [ownership, selectedPlayerId],
  );

  const trade = data?.trade || {};
  const balance = trade.balance || {};
  const efficiency = data?.efficiency || {};
  const isCommissioner = Boolean(hubContext?.is_commissioner);
  const scoringSeasonOptions = useMemo(() => {
    const fromApi = data?.scoring?.available_seasons || [];
    const current = data?.scoring?.season ? [String(data.scoring.season)] : [];
    return [...new Set([...fromApi.map(String), ...current, scoringSeason].filter(Boolean))].sort((a, b) => Number(b) - Number(a));
  }, [data, scoringSeason]);

  const activeScoringSeason = scoringSeason === "current"
    ? (data?.scoring?.requested_season || data?.scoring?.season || "")
    : scoringSeason;
  const scoringAwards = data?.scoring?.awards || data?.scoring_awards || [];
  const hasScoringPoints = useMemo(() => {
    const sc = data?.scoring;
    if (!sc?.available) return false;
    if ((sc.standings || []).some((t) => Number(t.total_points) > 0)) return true;
    return (sc.weeks || []).some((wk) => (wk.teams || []).some((t) => Number(t.points) > 0));
  }, [data]);
  const scoringSeasonLabel = activeScoringSeason === "all"
    ? "All time"
    : activeScoringSeason
      ? `${activeScoringSeason} season`
      : "Current season";
  const ownerMap = (activeTab === "scoring" && data?.scoring?.owner_map)
    ? data.scoring.owner_map
    : (data?.owner_map || {});
  const planningSeason = String(data?.planning_season || hubContext?.season || "");
  const scoringYearSpecific = Boolean(
    activeScoringSeason
    && activeScoringSeason !== "all"
    && planningSeason
    && String(activeScoringSeason) !== String(planningSeason),
  );
  const historic = data?.historic || {};
  const spendAwards = historic.awards || [];
  const capHistoryMode = capSeason === "all" ? "all" : capSeason === "current" ? "current" : "year";
  const capHistoryYear = capHistoryMode === "year" ? Number(capSeason) : null;
  const capHistoryLabel = historySeasonLabel(capHistoryMode, capHistoryYear);
  const capYearSpecific = capHistoryMode === "year";
  const capTeamsRaw = data?.analytics?.teams || [];
  const capPosGetters = useMemo(() => {
    const mode = spendMetric === "pct" ? "pct" : "dollars";
    const getters = {
      committed: (t) => t.committed,
      unspent: (t) => t.unspent,
    };
    for (const p of activePositions) {
      getters[`spend_${p}`] = (t) => metricValue(t, p, mode);
    }
    return getters;
  }, [activePositions, spendMetric]);
  const filteredCapTeams = useMemo(
    () => filterSortTeams(capTeamsRaw, {
      filter: capTeamFilter,
      sortKey: capSortKey,
      sortDir: capSortDir,
      ownerMap,
      yearSpecific: capYearSpecific,
      getters: capPosGetters,
    }),
    [capTeamsRaw, capTeamFilter, capSortKey, capSortDir, ownerMap, capYearSpecific, capPosGetters],
  );
  const filteredEfficiencyTeams = useMemo(
    () => filterSortTeams(efficiency.teams || [], {
      filter: capTeamFilter,
      sortKey: capEffSortKey,
      sortDir: capEffSortDir,
      ownerMap,
      yearSpecific: capYearSpecific,
      getters: {
        team: (t) => teamDisplayName(t, ownerMap, capYearSpecific).toLowerCase(),
        efficiency_rank: (t) => t.efficiency_rank,
        committed: (t) => t.committed,
        total_points: (t) => t.total_points,
        points_per_dollar: (t) => Number(t.points_per_dollar) || 0,
        top_position_spend: (t) => Number(t.top_position_spend) || 0,
        vs_league_avg_pct: (t) => Number(t.vs_league_avg_pct) || 0,
      },
    }),
    [efficiency.teams, capTeamFilter, capEffSortKey, capEffSortDir, ownerMap, capYearSpecific],
  );
  const scoringStandingsRaw = data?.scoring?.standings || [];
  const filteredScoringStandings = useMemo(
    () => filterSortTeams(scoringStandingsRaw, {
      filter: scoringTeamFilter,
      sortKey: scoringSortKey,
      sortDir: scoringSortDir,
      ownerMap,
      yearSpecific: scoringYearSpecific,
      getters: {
        total_points: (t) => t.total_points,
        avg_points: (t) => t.avg_points,
        weeks_scored: (t) => t.weeks_scored,
      },
    }),
    [scoringStandingsRaw, scoringTeamFilter, scoringSortKey, scoringSortDir, ownerMap, scoringYearSpecific],
  );
  const filteredScoringEfficiencyTeams = useMemo(
    () => filterSortTeams(efficiency.teams || [], {
      filter: scoringTeamFilter,
      sortKey: scoringEffSortKey,
      sortDir: scoringEffSortDir,
      ownerMap,
      yearSpecific: scoringYearSpecific,
      getters: {
        team: (t) => teamDisplayName(t, ownerMap, scoringYearSpecific).toLowerCase(),
        efficiency_rank: (t) => t.efficiency_rank,
        committed: (t) => t.committed,
        total_points: (t) => t.total_points,
        points_per_dollar: (t) => Number(t.points_per_dollar) || 0,
        top_position_spend: (t) => Number(t.top_position_spend) || 0,
        vs_league_avg_pct: (t) => Number(t.vs_league_avg_pct) || 0,
      },
    }),
    [efficiency.teams, scoringTeamFilter, scoringEffSortKey, scoringEffSortDir, ownerMap, scoringYearSpecific],
  );
  const historyMode = historySeason === "all" ? "all" : historySeason === "current" ? "current" : "year";
  const historyYear = historyMode === "year" ? Number(historySeason) : null;
  const historyLabel = historySeasonLabel(historyMode, historyYear);
  const usingHistoricCap = capHistoryMode !== "current" && Boolean(data?.analytics?.source === "contract_history");

  const onCapSeasonChange = (next) => {
    setCapSeason(next);
    setTeamPick("");
    load({
      activeTab: "cap",
      capSeason: next,
      sections: "cap",
      merge: true,
      keepSeason: true,
      background: true,
    });
  };

  const onHistorySeasonChange = (next) => {
    setHistorySeason(next);
  };

  const onScoringSeasonChange = (next) => {
    setScoringSeason(next);
    loadCacheRef.current.delete(`scoring:${next}`);
    load({
      activeTab: "scoring",
      scoringSeason: next,
      sections: "scoring",
      merge: true,
      keepSeason: true,
      keepChartHidden: true,
      background: true,
    });
  };

  const togglePosition = (pos) => {
    setVisiblePositions((prev) => {
      const next = new Set(prev);
      if (next.has(pos)) {
        if (next.size > 1) next.delete(pos);
      } else {
        next.add(pos);
      }
      return next;
    });
  };

  const proposalText = (suggestion) => {
    const partner = (trade.partners || []).find((p) => p.team_id === suggestion.partner_team_id);
    const sendLine = suggestion.send.map((x) => playerTradeLabel(x)).join(", ");
    const recvLine = suggestion.receive.map((x) => playerTradeLabel(x)).join(", ");
    return [
      `Trade proposal with ${partner?.team_name || "partner"}`,
      `Send: ${sendLine} (${fmtSal(suggestion.send_total_fair)} value)`,
      `Get: ${recvLine} (${fmtSal(suggestion.receive_total_fair)} value)`,
      suggestion.rationale || "",
    ].filter(Boolean).join("\n");
  };

  const copyProposal = async (suggestion) => {
    setMsg("");
    try {
      await navigator.clipboard.writeText(proposalText(suggestion));
      setMsg("Trade proposal copied — share with your commissioner or trade partner.");
    } catch {
      setMsg("Could not copy to clipboard.");
    }
  };

  const applyTrade = async (suggestion) => {
    const myId = trade.my_team_id;
    const partnerId = suggestion.partner_team_id;
    const sendA = suggestion.send.map((p) => p.player_id);
    const sendB = suggestion.receive.map((p) => p.player_id);
    setApplying(suggestion.partner_team_id + sendA.join());
    setMsg("");
    try {
      const res = await apiFetch(`/api/hub/league/${encodeURIComponent(leagueId)}/trade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          team_a_id: myId,
          team_b_id: partnerId,
          send_a: sendA,
          send_b: sendB,
        }),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      setMsg("Trade applied.");
      await load({
        activeTab: "trades",
        sections: "trades",
        merge: true,
        keepSeason: true,
        keepChartHidden: true,
      });
    } catch (e) {
      setMsg(connectionErrorMessage(e));
    } finally {
      setApplying("");
    }
  };

  if (loading && !data) {
    return (
      <div className="hub-insights">
        <div className="hub-insights-sticky">
          <HubSegmentNav tabs={INSIGHTS_TABS} active="cap" onChange={() => {}} ariaLabel="Insights" />
          <InsightsProgress active />
        </div>
        <HubPage className="hub-spend-page">
          <InsightsSkeleton />
        </HubPage>
      </div>
    );
  }

  const tableMode = spendMetric === "pct" ? "pct" : "dollars";
  const showCapCharts = activeTab === "cap" && !tabLoading && barData.length > 0 && pieData.length > 0;
  const showCapBarChart = activeTab === "cap" && !tabLoading && barData.length > 0;
  const showScoringCharts = activeTab === "scoring" && !tabLoading && data?.scoring?.available;

  return (
    <div className="hub-insights">
      {data?.draft_recap && (
        <DraftRecapPanel recap={data.draft_recap} />
      )}

      <div className="hub-insights-sticky">
        <HubSegmentNav tabs={INSIGHTS_TABS} active={activeTab} onChange={setActiveTab} ariaLabel="Insights" />
        <InsightsProgress active={tabLoading} />
      </div>

      {activeTab === "ownership" && (
        <InsightsSeasonBar
          value={historySeason}
          seasons={historic.seasons}
          historic={historic}
          onChange={onHistorySeasonChange}
          disabled={loading || tabLoading}
        />
      )}

      {activeTab === "contracts" && (
        <InsightsSeasonBar
          value={historySeason}
          seasons={historic.seasons}
          historic={historic}
          onChange={onHistorySeasonChange}
          disabled={loading || tabLoading}
          label="Contract season"
        />
      )}

      {error && <div className="error">{error}</div>}
      {msg && <p className="chart-note">{msg}</p>}

      {activeTab === "cap" && (
        <HubPage className="hub-spend-page">
          <header className="hub-section-head hub-section-head--row">
            <div>
              <h2 className="hub-tab-intro-title">Cap spend</h2>
              <p className="hub-section-hint">
                {usingHistoricCap
                  ? capHistoryLabel
                  : "Current rosters · pick a past season for history"}
              </p>
            </div>
            <div className="hub-insights-controls">
              <span className="hub-filter-label">Show as</span>
              <div className="hub-filter-scroll hub-insights-metric-filters-wrap">
              <div className="hub-insights-metric-filters">
                <HubFilterChip
                  active={spendMetric === "dollars"}
                  onClick={() => setSpendMetric("dollars")}
                >
                  Total $
                </HubFilterChip>
                <HubFilterChip
                  active={spendMetric === "pct"}
                  onClick={() => setSpendMetric("pct")}
                >
                  % of cap
                </HubFilterChip>
              </div>
              </div>
            </div>
          </header>

          <InsightsSeasonBar
            value={capSeason}
            seasons={historic.seasons}
            historic={historic}
            onChange={onCapSeasonChange}
            disabled={loading || tabLoading}
            label="Cap season"
            className="hub-insights-season-bar--spend"
          />

          <InsightsAwardsPanel
            awards={spendAwards}
            scopeLabel={capHistoryLabel}
            ownerMap={ownerMap}
            yearSpecific={capYearSpecific}
            expanded={capAwardsExpanded}
            onToggleExpanded={() => setCapAwardsExpanded((v) => !v)}
            visibleGroups={awardGroupToggles}
            onToggleGroup={toggleAwardGroup}
          />

          <div className="hub-insights-pos-filter">
            <span className="hub-filter-label">Positions</span>
            <HubFilterScroll>
              {positions.map((p) => (
                <HubFilterChip
                  key={p}
                  active={visiblePositions.has(p)}
                  onClick={() => togglePosition(p)}
                  accentColor={POS_COLORS[p]}
                >
                  {p}
                </HubFilterChip>
              ))}
            </HubFilterScroll>
          </div>

          {activeTab === "cap" && tabLoading && !showCapCharts && (
            <InsightsSkeleton />
          )}

          {showCapBarChart && (
          <div className="hub-insights-grid">
            <div className="hub-insights-chart-panel">
              <h3>Stacked spend</h3>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart
                  key={`${capSeason}-${barData.length}-${activePositions.join(",")}`}
                  data={barData}
                  margin={{ top: 8, right: 8, left: 0, bottom: chartBottomMargin }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                  <XAxis dataKey="name" tick={chartXTick} interval={mobileLayout ? "preserveStartEnd" : 0} />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v) => (spendMetric === "pct" ? `${v}%` : `$${v}`)}
                  />
                  <Tooltip formatter={(v) => formatMetric(v, tableMode)} />
                  <Legend />
                  {activePositions.map((p) => (
                    <Bar key={p} dataKey={p} stackId="pos" fill={POS_COLORS[p] || "#94a3b8"} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>

            {showCapCharts && (
            <div className="hub-insights-chart-panel">
              <h3>Team breakdown</h3>
              <select className="search-input" value={teamPick} onChange={(e) => setTeamPick(e.target.value)}>
                {(data?.analytics?.teams || []).map((t) => (
                  <option key={t.team_id} value={t.team_id}>{t.team_name}</option>
                ))}
              </select>
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={90} paddingAngle={2}>
                    {pieData.map((entry) => (
                      <Cell key={entry.name} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v) => formatMetric(v, tableMode)} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
            )}
          </div>
          )}

          {efficiency?.available && (efficiency.teams || []).length > 0 && (
            <div className="hub-insights-efficiency">
              <h3 className="hub-panel-subtitle">
                Cap efficiency
                {efficiency.season ? ` · ${efficiency.season}` : activeScoringSeason ? ` · ${activeScoringSeason}` : ""}
              </h3>
              {efficiency.league_avg_points_per_dollar != null && (
                <p className="chart-note">
                  League average {efficiency.league_avg_points_per_dollar} fantasy pts per committed $
                </p>
              )}
              {mobileLayout ? (
                <MobileDataList>
                  {filteredEfficiencyTeams.map((t) => (
                    <MobilePlayerCard
                      key={t.team_id || t.team_name}
                      name={t.team_name}
                      meta={`#${t.efficiency_rank} · ${t.total_points} pts`}
                      heroValue={t.points_per_dollar ?? "—"}
                      heroLabel="pts/$"
                      expanded={(
                        <div className="mobile-stat-grid">
                          <MobileStat label="Committed" value={fmtSal(t.committed)} />
                          <MobileStat label="Points" value={t.total_points} />
                          <MobileStat
                            label="Top spend"
                            value={
                              t.top_spend_position
                                ? `${t.top_spend_position} ${fmtSal(t.top_position_spend)}`
                                : "—"
                            }
                          />
                          <MobileStat
                            label="vs avg"
                            value={
                              t.vs_league_avg_pct != null
                                ? `${t.vs_league_avg_pct > 0 ? "+" : ""}${t.vs_league_avg_pct}%`
                                : "—"
                            }
                          />
                        </div>
                      )}
                    />
                  ))}
                </MobileDataList>
              ) : (
              <div className="table-wrap">
                <table className="data-table hub-table hub-insights-efficiency-table">
                  <thead>
                    <tr>
                      <SortTh label="Rank" col="efficiency_rank" sortKey={capEffSortKey} sortDir={capEffSortDir} onSort={onCapEffSort} />
                      <SortTh label="Team" col="team" sortKey={capEffSortKey} sortDir={capEffSortDir} onSort={onCapEffSort} />
                      <SortTh label="Committed" col="committed" sortKey={capEffSortKey} sortDir={capEffSortDir} onSort={onCapEffSort} />
                      <SortTh label="Points" col="total_points" sortKey={capEffSortKey} sortDir={capEffSortDir} onSort={onCapEffSort} />
                      <SortTh label="Pts/$" col="points_per_dollar" sortKey={capEffSortKey} sortDir={capEffSortDir} onSort={onCapEffSort} />
                      <SortTh label="Top spend" col="top_position_spend" sortKey={capEffSortKey} sortDir={capEffSortDir} onSort={onCapEffSort} />
                      <SortTh label="vs avg" col="vs_league_avg_pct" sortKey={capEffSortKey} sortDir={capEffSortDir} onSort={onCapEffSort} />
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEfficiencyTeams.map((t) => (
                      <tr key={t.team_id || t.team_name}>
                        <td>#{t.efficiency_rank}</td>
                        <td>{teamDisplayName(t, ownerMap, capYearSpecific)}</td>
                        <td>{fmtSal(t.committed)}</td>
                        <td>{t.total_points}</td>
                        <td>{t.points_per_dollar ?? "—"}</td>
                        <td>
                          {t.top_spend_position
                            ? `${t.top_spend_position} ${fmtSal(t.top_position_spend)}`
                            : "—"}
                        </td>
                        <td>
                          {t.vs_league_avg_pct != null
                            ? `${t.vs_league_avg_pct > 0 ? "+" : ""}${t.vs_league_avg_pct}%`
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              )}
            </div>
          )}

          <div className="hub-table-card hub-insights-table-wrap">
          <h3 className="hub-panel-subtitle hub-insights-table-title">Team breakdown</h3>
          <InsightsTableToolbar
            search={capTeamFilter}
            onSearchChange={setCapTeamFilter}
            placeholder="Filter teams…"
            count={filteredCapTeams.length}
            total={capTeamsRaw.length}
          />
          {mobileLayout ? (
            <MobileDataList>
              {filteredCapTeams.map((t) => (
                <MobilePlayerCard
                  key={t.team_id}
                  name={t.team_name}
                  meta={`${fmtSal(t.unspent)} unspent`}
                  heroValue={fmtSal(t.committed)}
                  heroLabel="committed"
                  expanded={(
                    <div className="mobile-stat-grid">
                      {activePositions.map((p) => (
                        <MobileStat
                          key={p}
                          label={`${p} ${spendMetric === "pct" ? "%" : "$"}`}
                          value={(
                            <>
                              {formatMetric(metricValue(t, p, tableMode), tableMode)}
                              {spendMetric === "dollars" && t.pct_by_position?.[p] != null && (
                                <span className="table-meta"> ({t.pct_by_position[p]}%)</span>
                              )}
                            </>
                          )}
                        />
                      ))}
                    </div>
                  )}
                />
              ))}
            </MobileDataList>
          ) : (
          <div className="table-wrap">
            <table className="data-table hub-table">
              <thead>
                <tr>
                  <SortTh label="Team" col="team" sortKey={capSortKey} sortDir={capSortDir} onSort={onCapSort} />
                  {activePositions.map((p) => (
                    <SortTh
                      key={p}
                      label={`${p} ${spendMetric === "pct" ? "%" : "$"}`}
                      col={`spend_${p}`}
                      sortKey={capSortKey}
                      sortDir={capSortDir}
                      onSort={onCapSort}
                    />
                  ))}
                  <SortTh label="Committed" col="committed" sortKey={capSortKey} sortDir={capSortDir} onSort={onCapSort} />
                  <SortTh label="Unspent" col="unspent" sortKey={capSortKey} sortDir={capSortDir} onSort={onCapSort} />
                </tr>
              </thead>
              <tbody>
                {filteredCapTeams.map((t) => (
                  <tr key={t.team_id}>
                    <td>{teamDisplayName(t, ownerMap, capYearSpecific)}</td>
                    {activePositions.map((p) => (
                      <td key={p}>
                        {formatMetric(metricValue(t, p, tableMode), tableMode)}
                        {spendMetric === "dollars" && t.pct_by_position?.[p] != null && (
                          <span className="table-meta"> ({t.pct_by_position[p]}%)</span>
                        )}
                      </td>
                    ))}
                    <td>{fmtSal(t.committed)}</td>
                    <td>{fmtSal(t.unspent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
          {filteredCapTeams.length === 0 && (
            <p className="chart-note">No teams match this filter.</p>
          )}
          </div>
        </HubPage>
      )}

      {activeTab === "scoring" && (
        <HubPage className="hub-insights-scoring hub-spend-page">
          <header className="hub-section-head hub-section-head--row">
            <div>
              <h2 className="hub-tab-intro-title">Scoring</h2>
              <p className="hub-section-hint">
                {data?.scoring?.available
                  ? `${scoringSeasonLabel} · from Sleeper`
                  : "Link Sleeper in Setup to see scoring"}
              </p>
            </div>
          </header>

          {data?.scoring?.available && (data?.scoring?.available_seasons || scoringSeasonOptions).length > 0 && (
            <div className="hub-insights-season-bar hub-insights-season-bar--scoring">
              <InsightsSeasonBar
                value={scoringSeason}
                seasons={(data?.scoring?.available_seasons || scoringSeasonOptions)
                  .map((s) => Number(s))
                  .filter((n) => !Number.isNaN(n))}
                historic={{ available: true }}
                onChange={onScoringSeasonChange}
                disabled={loading || tabLoading}
                label="Scoring season"
              />
              <div className="hub-insights-scoring-season-meta">
                {data?.scoring?.cached && data.scoring.synced_at && formatRelativeTime(data.scoring.synced_at) && (
                  <span className="table-meta hub-insights-scoring-synced">{formatRelativeTime(data.scoring.synced_at)}</span>
                )}
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={() => {
                    loadCacheRef.current.delete(`scoring:${scoringSeason}`);
                    load({
                      activeTab: "scoring",
                      sections: "scoring",
                      refresh: true,
                      merge: true,
                      keepSeason: true,
                      keepChartHidden: true,
                      background: true,
                      scoringSeason,
                    });
                  }}
                  disabled={loading || tabLoading}
                >
                  {tabLoading ? "Refreshing…" : "Refresh from Sleeper"}
                </button>
              </div>
            </div>
          )}

          {!data?.scoring?.available && (
            <ScoringEmptyState
              scoring={data?.scoring}
              hubContext={hubContext}
              onNavigate={onNavigate}
              onRefresh={() => load({
                activeTab: "scoring",
                sections: "scoring",
                refresh: true,
                merge: true,
                keepSeason: true,
              })}
            />
          )}

          {data?.scoring?.available && data?.scoring?.preseason && (
            <InsightsCrimeReportPlaceholder
              title="Scoring awards"
              subtitle="Season highlights"
              scopeLabel={scoringSeasonLabel}
              message={data.scoring.hint || "Season has not started yet."}
            />
          )}

          {data?.scoring?.available && !data?.scoring?.preseason && scoringAwards.length > 0 && (
            <InsightsAwardsPanel
              awards={scoringAwards}
              scopeLabel={scoringSeasonLabel}
              title="Scoring awards"
              subtitle="Season highlights"
              ownerMap={ownerMap}
              yearSpecific={scoringYearSpecific}
              expanded={scoringAwardsExpanded}
              onToggleExpanded={() => setScoringAwardsExpanded((v) => !v)}
              visibleGroups={awardGroupToggles}
              onToggleGroup={toggleAwardGroup}
            />
          )}

          {data?.scoring?.available && !data?.scoring?.preseason && scoringAwards.length === 0 && hasScoringPoints && (
            <InsightsCrimeReportPlaceholder
              title="Scoring awards"
              subtitle="Season highlights"
              scopeLabel={scoringSeasonLabel}
              message={
                tabLoading
                  ? "Loading awards…"
                  : "Awards still loading — tap Refresh from Sleeper."
              }
            />
          )}

          {data?.scoring?.available && !data?.scoring?.preseason && !hasScoringPoints && (
            <InsightsCrimeReportPlaceholder
              title="Scoring awards"
              subtitle="Season highlights"
              scopeLabel={scoringSeasonLabel}
              message="No scored weeks yet — check back after your league plays."
            />
          )}

          {data?.scoring?.available && (
            <>
              {showScoringCharts && scoringLineData.length > 0 && chartVisibleTeams.length > 0 ? (
                <div className="hub-insights-chart-panel">
                  <h3>Points by week</h3>
                  <ResponsiveContainer width="100%" height={320}>
                    <LineChart
                      data={scoringLineData}
                      margin={{ top: 8, right: 8, left: 0, bottom: chartBottomMargin }}
                      onMouseLeave={() => setChartHoveredTeam("")}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                      <XAxis dataKey="week" tick={chartXTick} interval={mobileLayout ? "preserveStartEnd" : 0} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Legend
                        className="hub-insights-chart-legend"
                        onClick={handleLegendClick}
                        wrapperStyle={{ cursor: "pointer" }}
                      />
                      {chartVisibleTeams.map((name) => {
                        const active = !chartHoveredTeam || chartHoveredTeam === name;
                        const emphasized = chartHoveredTeam === name;
                        return (
                          <Line
                            key={name}
                            type="monotone"
                            dataKey={name}
                            stroke={scoringColorByTeam[name] || "#94a3b8"}
                            strokeDasharray={scoringDashByTeam[name]}
                            strokeOpacity={active ? 1 : 0.22}
                            strokeWidth={emphasized ? 3 : 2}
                            dot={emphasized ? { r: 3, strokeWidth: 0 } : false}
                            activeDot={emphasized ? { r: 5 } : false}
                            onMouseEnter={() => setChartHoveredTeam(name)}
                            onMouseLeave={() => setChartHoveredTeam("")}
                          />
                        );
                      })}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : showScoringCharts && scoringLineData.length > 0 ? (
                <p className="chart-note hub-insights-chart-placeholder">
                  All teams hidden — use Chart column in the table to show lines again.
                </p>
              ) : (
                <p className="chart-note hub-insights-chart-placeholder">
                  Weekly chart appears after the first scored week in Sleeper.
                </p>
              )}

              <div className="hub-table-card hub-insights-table-wrap">
                <h3 className="hub-panel-subtitle hub-insights-table-title">Standings</h3>
                <InsightsTableToolbar
                  search={scoringTeamFilter}
                  onSearchChange={setScoringTeamFilter}
                  placeholder="Filter teams…"
                  count={filteredScoringStandings.length}
                  total={scoringStandingsRaw.length}
                />
                {mobileLayout ? (
                  <div className="hub-insights-scoring-standings">
                    {filteredScoringStandings.map((t, idx) => {
                      const hidden = chartHiddenTeams.has(t.team_name);
                      return (
                        <button
                          key={t.team_name}
                          type="button"
                          className={`hub-insights-standing-card${hidden ? " hub-insights-standing-card--hidden" : ""}${chartHoveredTeam === t.team_name ? " hub-insights-standing-card--hover" : ""}`}
                          onClick={() => toggleChartTeam(t.team_name)}
                          onMouseEnter={() => setChartHoveredTeam(t.team_name)}
                          onMouseLeave={() => setChartHoveredTeam("")}
                          style={{ borderLeftColor: scoringColorByTeam[t.team_name] || "var(--border)" }}
                        >
                          <span className="hub-insights-standing-rank">#{idx + 1}</span>
                          <strong>{teamDisplayName(t, ownerMap, scoringYearSpecific)}</strong>
                          <span className="chart-note">{t.total_points} pts · {t.avg_points} avg</span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="table-wrap">
                    <table className="data-table hub-table hub-insights-scoring-table">
                      <thead>
                        <tr>
                          <th>#</th>
                          <SortTh label="Team" col="team" sortKey={scoringSortKey} sortDir={scoringSortDir} onSort={onScoringSort} />
                          <SortTh label="Total pts" col="total_points" sortKey={scoringSortKey} sortDir={scoringSortDir} onSort={onScoringSort} />
                          <SortTh label="Avg" col="avg_points" sortKey={scoringSortKey} sortDir={scoringSortDir} onSort={onScoringSort} />
                          <SortTh label="Weeks" col="weeks_scored" sortKey={scoringSortKey} sortDir={scoringSortDir} onSort={onScoringSort} />
                          <th>Chart</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredScoringStandings.map((t, idx) => {
                          const hidden = chartHiddenTeams.has(t.team_name);
                          return (
                            <tr
                              key={t.team_name}
                              className={`${hidden ? "hub-insights-row--muted" : ""}${chartHoveredTeam === t.team_name ? " hub-insights-row--hover" : ""}`.trim()}
                              onMouseEnter={() => setChartHoveredTeam(t.team_name)}
                              onMouseLeave={() => setChartHoveredTeam("")}
                            >
                              <td>#{idx + 1}</td>
                              <td>{teamDisplayName(t, ownerMap, scoringYearSpecific)}</td>
                              <td>{t.total_points}</td>
                              <td>{t.avg_points}</td>
                              <td>{t.weeks_scored ?? "—"}</td>
                              <td>
                                <button
                                  type="button"
                                  className="btn-ghost btn-sm"
                                  onClick={() => toggleChartTeam(t.team_name)}
                                >
                                  {hidden ? "Show" : "Hide"}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                {filteredScoringStandings.length === 0 && (
                  <p className="chart-note">No teams match this filter.</p>
                )}
              </div>

              {efficiency?.available && (efficiency.teams || []).length > 0 && (
                <div className="hub-insights-efficiency">
                  <h3 className="hub-panel-subtitle">
                    Cap efficiency
                    {efficiency.season ? ` · ${efficiency.season}` : activeScoringSeason ? ` · ${activeScoringSeason}` : ""}
                  </h3>
                  {efficiency.league_avg_points_per_dollar != null && (
                    <p className="chart-note">
                      League average {efficiency.league_avg_points_per_dollar} fantasy pts per committed $
                    </p>
                  )}
                  {mobileLayout ? (
                    <MobileDataList>
                      {filteredScoringEfficiencyTeams.map((t) => (
                        <MobilePlayerCard
                          key={t.team_id || t.team_name}
                          name={t.team_name}
                          meta={`#${t.efficiency_rank} · ${t.total_points} pts`}
                          heroValue={t.points_per_dollar ?? "—"}
                          heroLabel="pts/$"
                          expanded={(
                            <div className="mobile-stat-grid">
                              <MobileStat label="Committed" value={fmtSal(t.committed)} />
                              <MobileStat label="Points" value={t.total_points} />
                              <MobileStat
                                label="Top spend"
                                value={
                                  t.top_spend_position
                                    ? `${t.top_spend_position} ${fmtSal(t.top_position_spend)}`
                                    : "—"
                                }
                              />
                              <MobileStat
                                label="vs avg"
                                value={
                                  t.vs_league_avg_pct != null
                                    ? `${t.vs_league_avg_pct > 0 ? "+" : ""}${t.vs_league_avg_pct}%`
                                    : "—"
                                }
                              />
                            </div>
                          )}
                        />
                      ))}
                    </MobileDataList>
                  ) : (
                  <div className="table-wrap">
                    <table className="data-table hub-table hub-insights-efficiency-table">
                      <thead>
                        <tr>
                          <SortTh label="Rank" col="efficiency_rank" sortKey={scoringEffSortKey} sortDir={scoringEffSortDir} onSort={onScoringEffSort} />
                          <SortTh label="Team" col="team" sortKey={scoringEffSortKey} sortDir={scoringEffSortDir} onSort={onScoringEffSort} />
                          <SortTh label="Committed" col="committed" sortKey={scoringEffSortKey} sortDir={scoringEffSortDir} onSort={onScoringEffSort} />
                          <SortTh label="Points" col="total_points" sortKey={scoringEffSortKey} sortDir={scoringEffSortDir} onSort={onScoringEffSort} />
                          <SortTh label="Pts/$" col="points_per_dollar" sortKey={scoringEffSortKey} sortDir={scoringEffSortDir} onSort={onScoringEffSort} />
                          <SortTh label="Top spend" col="top_position_spend" sortKey={scoringEffSortKey} sortDir={scoringEffSortDir} onSort={onScoringEffSort} />
                          <SortTh label="vs avg" col="vs_league_avg_pct" sortKey={scoringEffSortKey} sortDir={scoringEffSortDir} onSort={onScoringEffSort} />
                        </tr>
                      </thead>
                      <tbody>
                        {filteredScoringEfficiencyTeams.map((t) => (
                          <tr key={t.team_id || t.team_name}>
                            <td>#{t.efficiency_rank}</td>
                            <td>{teamDisplayName(t, ownerMap, scoringYearSpecific)}</td>
                            <td>{fmtSal(t.committed)}</td>
                            <td>{t.total_points}</td>
                            <td>{t.points_per_dollar ?? "—"}</td>
                            <td>
                              {t.top_spend_position
                                ? `${t.top_spend_position} ${fmtSal(t.top_position_spend)}`
                                : "—"}
                            </td>
                            <td>
                              {t.vs_league_avg_pct != null
                                ? `${t.vs_league_avg_pct > 0 ? "+" : ""}${t.vs_league_avg_pct}%`
                                : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  )}
                </div>
              )}
            </>
          )}
        </HubPage>
      )}

      {activeTab === "ownership" && (
        <HubPage className="hub-player-history-page">
          <header className="hub-section-head hub-section-head--row">
            <div>
              <h2 className="hub-tab-intro-title">History</h2>
              <p className="hub-section-hint">
                {historyLabel}
                {" · "}
                {ownership?.player_count ?? 0} players
                {ownership?.has_contract_history && " · includes sheet data"}
                {ownership?.ownership_synced_at && (
                  <span className="table-meta">
                    {" · synced "}
                    {formatRelativeTime(ownership.ownership_synced_at)}
                  </span>
                )}
              </p>
            </div>
            <div className="hub-insights-controls">
              <button
                type="button"
                className="btn-ghost btn-sm"
                disabled={ownershipLoading || ownershipSeasonLoading}
                onClick={() => loadOwnershipHistory({ refresh: true, keepSelection: true })}
              >
                {ownershipSeasonLoading ? "Loading…" : "Refresh history"}
              </button>
            </div>
          </header>
          {ownershipError && <p className="chart-note error">{ownershipError}</p>}
          {ownership?.hint && (
            <p className="chart-note hub-insights-scoring-hint">{ownership.hint}</p>
          )}
          {ownershipLoading && (
            <p className="chart-note">Loading player list…</p>
          )}
          {ownershipSeasonLoading && (
            <p className="chart-note">Loading Sleeper history…</p>
          )}
          {!ownershipLoading && !loading && filteredPlayers.length === 0 && (
            <p className="chart-note">
              No players for this view. Try another season.
            </p>
          )}
          <div className="hub-insights-ownership-layout hub-player-history-layout">
            <div className="hub-insights-ownership-list hub-player-history-list">
              <input
                type="search"
                className="search-input"
                placeholder="Search player…"
                value={playerSearch}
                onChange={(e) => setPlayerSearch(e.target.value)}
              />
              <ul className="hub-insights-player-list hub-player-history-roster">
                {filteredPlayers.map((p) => {
                  const stats = p.contract_stats || {};
                  return (
                    <li key={p.player_id}>
                      <button
                        type="button"
                        className={`hub-insights-player-btn hub-player-history-row${selectedPlayerId === p.player_id ? " active" : ""}`}
                        onClick={() => setSelectedPlayerId(p.player_id)}
                      >
                        <PlayerCell
                          name={p.player_name}
                          team={p.team}
                          playerId={p.player_id}
                          media={ownershipMedia}
                          size="sm"
                        />
                        <div className="hub-player-history-row-meta">
                          <span className="hub-player-history-pos">{p.position || "—"}</span>
                          {stats.avg_cap != null && (
                            <span className="hub-player-history-mini-stat">{fmtSal(stats.avg_cap)} avg</span>
                          )}
                          {stats.team_count > 0 && (
                            <span className="hub-player-history-mini-stat">{stats.team_count} team{stats.team_count === 1 ? "" : "s"}</span>
                          )}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
            <div className="hub-insights-ownership-detail hub-player-history-detail">
              {!selectedPlayer && (
                <p className="chart-note">Pick a player to see teams and timeline.</p>
              )}
              {selectedPlayer && (
                <div className="hub-player-history-card">
                  <div className="hub-player-history-hero">
                    <PlayerCell
                      name={selectedPlayer.player_name}
                      team={selectedPlayer.team}
                      playerId={selectedPlayer.player_id}
                      media={ownershipMedia}
                      size="lg"
                      className="hub-insights-player-detail-head"
                    />
                    <div className="hub-player-history-stat-grid">
                      <PlayerHistoryStat
                        label="Avg contract"
                        value={selectedPlayer.contract_stats?.avg_cap != null ? fmtSal(selectedPlayer.contract_stats.avg_cap) : "—"}
                      />
                      <PlayerHistoryStat
                        label="Peak cap"
                        value={selectedPlayer.contract_stats?.max_cap != null ? fmtSal(selectedPlayer.contract_stats.max_cap) : "—"}
                      />
                      <PlayerHistoryStat
                        label="Teams owned"
                        value={selectedPlayer.contract_stats?.team_count ?? "—"}
                        hint={
                          (selectedPlayer.contract_stats?.teams_owned || []).length
                            ? selectedPlayer.contract_stats.teams_owned.join(", ")
                            : null
                        }
                      />
                      <PlayerHistoryStat
                        label="Seasons"
                        value={selectedPlayer.contract_stats?.season_count ?? "—"}
                        hint={
                          (selectedPlayer.contract_stats?.seasons || []).length
                            ? selectedPlayer.contract_stats.seasons.join(" · ")
                            : null
                        }
                      />
                    </div>
                  </div>
                  {(selectedPlayer.current_owners || []).length > 0 && historySeason === "current" && (
                    <div className="hub-player-history-current">
                      <span className="hub-filter-label">Current roster</span>
                      {(selectedPlayer.current_owners || []).map((o) => (
                        <p key={o.team_id} className="chart-note">
                          {o.team_name}: {fmtSal(o.salary)}/yr · {o.position}
                        </p>
                      ))}
                    </div>
                  )}
                  <div className="hub-player-history-timeline-wrap">
                    <span className="hub-filter-label">Timeline · {historyLabel}</span>
                    <PlayerHistoryTimeline events={selectedPlayer.timeline || []} />
                  </div>
                </div>
              )}
            </div>
          </div>
        </HubPage>
      )}

      {activeTab === "contracts" && (
        <LeagueContractHistory
          leagueId={leagueId}
          hubContext={hubContext}
          seasonFilter={historySeason === "current" ? "" : historySeason}
        />
      )}

      {activeTab === "trades" && (
        <HubPage>
          <header className="hub-section-head">
            <h2 className="hub-tab-intro-title">Trades</h2>
            <p className="hub-section-hint">
              Trade ideas from roster gaps and player value.
            </p>
          </header>
          <div className="hub-insights-balance">
            {(balance.need || []).length > 0 && (
              <div className="hub-insights-balance-group">
                <span className="hub-filter-label">Roster gaps</span>
                <div className="hub-insights-balance-chips">
                  {(balance.need || []).map((p) => (
                    <Chip key={`need-${p}`} label={`${p} thin`} tone="need" />
                  ))}
                </div>
              </div>
            )}
            {(trade.actionable_needs || []).length > 0 && (
              <div className="hub-insights-balance-group">
                <span className="hub-filter-label">Shoppable needs</span>
                <div className="hub-insights-balance-chips">
                  {(trade.actionable_needs || []).map((p) => (
                    <Chip key={`act-${p}`} label={`${p} available`} tone="need" />
                  ))}
                </div>
              </div>
            )}
            {(balance.surplus || []).length > 0 && (
              <div className="hub-insights-balance-group">
                <span className="hub-filter-label">Tradeable depth</span>
                <div className="hub-insights-balance-chips">
                  {(balance.surplus || []).map((p) => (
                    <Chip key={`sur-${p}`} label={`${p} extra`} tone="surplus" />
                  ))}
                </div>
              </div>
            )}
          </div>

          {(trade.suggestions || []).length > 0 ? (
            <div className="hub-insights-suggestions-primary">
              <h3 className="hub-panel-subtitle">Suggested packages</h3>
              {(trade.suggestions || []).map((s, idx) => {
                const partner = (trade.partners || []).find((p) => p.team_id === s.partner_team_id);
                return (
                  <div key={`${s.partner_team_id}-${idx}`} className="hub-insights-suggestion">
                    <p className="hub-insights-suggestion-rationale">{s.rationale}</p>
                    {(s.fills_needs || []).length > 0 && (
                      <p className="chart-note">
                        Fills: {(s.fills_needs || []).join(", ")}
                        {(s.moves_surplus || []).length > 0 ? ` · Moves: ${(s.moves_surplus || []).join(", ")}` : ""}
                      </p>
                    )}
                    <p className="table-meta hub-insights-trade-players">
                      <strong>{partner?.team_name || s.partner_team_name || "Partner"}</strong>
                      {" · "}
                      Send:{" "}
                      {s.send.map((x, i) => (
                        <span key={x.player_id || i}>
                          {i > 0 ? ", " : ""}
                          <PlayerCell
                            name={x.player_name}
                            playerId={x.player_id}
                            media={tradeMedia}
                            size="sm"
                            showTeam={false}
                          />
                          {x.salary != null ? ` (${fmtSal(x.salary)})` : ""}
                        </span>
                      ))}
                      {" "}({fmtSal(s.send_total_fair)} value)
                      {" · "}
                      Get:{" "}
                      {s.receive.map((x, i) => (
                        <span key={x.player_id || i}>
                          {i > 0 ? ", " : ""}
                          <PlayerCell
                            name={x.player_name}
                            playerId={x.player_id}
                            media={tradeMedia}
                            size="sm"
                            showTeam={false}
                          />
                          {x.salary != null ? ` (${fmtSal(x.salary)})` : ""}
                        </span>
                      ))}
                      {" "}({fmtSal(s.receive_total_fair)} value)
                    </p>
                    <div className="hub-insights-suggestion-actions">
                      <button type="button" className="btn-ghost btn-sm" onClick={() => copyProposal(s)}>
                        Copy proposal
                      </button>
                      {isCommissioner && (
                        <button
                          type="button"
                          className="btn-ghost btn-sm"
                          disabled={Boolean(applying)}
                          onClick={() => {
                            if (window.confirm("Apply this trade for all teams?")) applyTrade(s);
                          }}
                        >
                          Apply trade
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="hub-insights-empty-state">
              <h3>No trade packages yet</h3>
              <p>{trade.empty_reason || "Import rosters and salaries, then check back."}</p>
            </div>
          )}

          {(trade.partners || []).length > 0 && (
            <div className="hub-insights-partners">
              <h3 className="hub-panel-subtitle">Trade partners</h3>
              {(trade.partners || []).map((p) => (
                <div key={p.team_id} className="hub-insights-partner">
                  <button
                    type="button"
                    className="hub-insights-partner-head"
                    onClick={() => setExpandedPartner(expandedPartner === p.team_id ? "" : p.team_id)}
                  >
                    <strong>{p.team_name}</strong>
                    <span className="table-meta">
                      Fit {p.fit_score} · {fmtSal(p.cap_remaining)} left
                      {(p.their_surplus || []).length > 0 && ` · surplus ${(p.their_surplus || []).join(", ")}`}
                      {(p.their_need || []).length > 0 && ` · needs ${(p.their_need || []).join(", ")}`}
                    </span>
                  </button>
                  {expandedPartner === p.team_id && (
                    <div className="hub-insights-suggestions">
                      {(trade.suggestions || [])
                        .filter((s) => s.partner_team_id === p.team_id)
                        .map((s, idx) => (
                          <div key={idx} className="hub-insights-suggestion hub-insights-suggestion--compact">
                            <p>{s.rationale}</p>
                          </div>
                        ))}
                      {(trade.suggestions || []).filter((s) => s.partner_team_id === p.team_id).length === 0 && (
                        <p className="chart-note">No balanced packages with this team yet.</p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </HubPage>
      )}
    </div>
  );
}
