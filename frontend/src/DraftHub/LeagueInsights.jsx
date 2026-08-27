import React, { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { apiFetch } from "../auth";
import { connectionErrorMessage, formatRelativeTime, parseApiError } from "../format";
import useMobileLayout from "../useMobileLayout";
import MobileDataList, { MobileStat } from "../MobileDataList";
import MobilePlayerCard from "../MobilePlayerCard";
import DraftRecapPanel from "./DraftRecapPanel";
import {
  HubExperienceHero,
  HubFilterChip,
  HubFilterScroll,
  HubPage,
  HubSegmentNav,
  SortTh,
} from "./HubUILayout";
import { InsightsProgress, InsightsSkeleton } from "./insights/InsightsChrome";
import {
  FeaturedAwards,
  InsightsDisclosure,
  MoreAwards,
  PositionSpendBoard,
  ScoringRace,
} from "./insights/InsightsTalk";
import InsightsOverview from "./insights/InsightsOverview";
import {
  POS_COLORS,
  featureAwards,
  formatSpendValue,
  insightsHeroStatus,
  metricValue,
  pickDiscussablePosition,
  positionSpendLeaders,
  scoringRaceRows,
  teamDisplayName,
} from "./insights/insightsPresentation";
import {
  INSIGHTS_TAB_SECTIONS,
  resolveAnalyticsPositions,
  useInsightsData,
} from "./insights/useInsightsData";
import {
  defaultInsightTab,
  isInsightTabAllowed,
  normalizeInsightTab,
  visibleInsightsTabs,
} from "./hubInsightsTabs";
import {
  ownershipRefreshAffordance,
  scoringWaitingCopy,
  shouldShowScoringTables,
} from "./insightsEmptyStates";
import { fmtSal } from "./rosterFormat";
import PlayerCell, { usePlayerMedia } from "../PlayerCell";

const InsightsCharts = lazy(() => import("./insights/InsightsCharts"));

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

function InsightsTableToolbar({ search, onSearchChange, placeholder, count, total, noun = "teams" }) {
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
        {count === total ? `${count} ${noun}` : `${count} of ${total} ${noun}`}
      </span>
    </div>
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
    "pct_committed",
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

function ChartFallback() {
  return <div className="hub-insights-skeleton-block hub-insights-skeleton-block--chart" aria-hidden />;
}

function matchOwnershipPlayer(players, rawId) {
  const id = String(rawId || "");
  if (!id || !players?.length) return null;
  return players.find((p) => String(p.player_id) === id)
    || players.find((p) => String(p.sleeper_player_id) === id)
    || players.find((p) => {
      const pid = String(p.player_id || "");
      return pid && (pid.endsWith(id) || id.endsWith(pid));
    })
    || null;
}

export default function LeagueInsights({
  leagueId,
  hubContext,
  onNavigate,
  activeTab: activeTabProp,
  onActiveTabChange,
  onWorkspaceSaved,
}) {
  const [searchParams] = useSearchParams();
  const playerFromUrl = searchParams.get("player") || "";
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tabLoading, setTabLoading] = useState(false);
  const [error, setError] = useState("");
  const [teamPick, setTeamPick] = useState("");
  const [activeTabLocal, setActiveTabLocal] = useState("overview");
  const activeTab = normalizeInsightTab(activeTabProp || activeTabLocal);
  const setActiveTab = useCallback(
    (tab) => {
      setActiveTabLocal(tab);
      if (onActiveTabChange) onActiveTabChange(tab);
    },
    [onActiveTabChange],
  );

  useEffect(() => {
    if (activeTabProp) setActiveTabLocal(activeTabProp);
  }, [activeTabProp]);

  const isCommissioner = Boolean(hubContext?.is_commissioner);
  const insightsTabs = useMemo(
    () => visibleInsightsTabs(isCommissioner),
    [isCommissioner],
  );

  useEffect(() => {
    if (!isInsightTabAllowed(activeTab, isCommissioner)) {
      const fallback = defaultInsightTab(isCommissioner);
      setActiveTabLocal(fallback);
      onActiveTabChange?.(fallback);
    }
  }, [activeTab, isCommissioner, onActiveTabChange]);

  const [spendMetric, setSpendMetric] = useState("dollars");
  const [visiblePositions, setVisiblePositions] = useState(() => new Set());
  const [playerSearch, setPlayerSearch] = useState("");
  const [selectedPlayerId, setSelectedPlayerId] = useState("");
  const [ownershipData, setOwnershipData] = useState(null);
  const [ownershipLoading, setOwnershipLoading] = useState(false);
  const [ownershipSeasonLoading, setOwnershipSeasonLoading] = useState(false);
  const [ownershipError, setOwnershipError] = useState("");
  const [scoringSeason, setScoringSeason] = useState("current");
  const [capSeason, setCapSeason] = useState("current");
  const [historySeason, setHistorySeason] = useState(
    () => (searchParams.get("player") ? "all" : "current"),
  );
  const [chartHiddenTeams, setChartHiddenTeams] = useState(() => new Set());
  const [chartHoveredTeam, setChartHoveredTeam] = useState("");
  const [positionFocus, setPositionFocus] = useState("");
  const [capChartsOpen, setCapChartsOpen] = useState(false);
  const [scoringChartsOpen, setScoringChartsOpen] = useState(false);
  const [awardGroupToggles, setAwardGroupToggles] = useState({
    good: true,
    bad: true,
    other: true,
  });
  const [capTeamFilter, setCapTeamFilter] = useState("");
  const [capSortKey, setCapSortKey] = useState("committed");
  const [capSortDir, setCapSortDir] = useState("desc");
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
  const ownershipGenRef = React.useRef(0);
  const prevTabRef = React.useRef(activeTab);
  const activeTabRef = React.useRef(activeTab);
  const latestScoringSeasonRef = React.useRef("");
  const dataRef = React.useRef(null);
  const capSeasonRef = React.useRef(capSeason);
  const historySeasonRef = React.useRef(historySeason);
  const scoringSeasonRef = React.useRef(scoringSeason);
  const hubContextRef = React.useRef(hubContext);
  const selectedPlayerIdRef = React.useRef(selectedPlayerId);
  activeTabRef.current = activeTab;
  capSeasonRef.current = capSeason;
  historySeasonRef.current = historySeason;
  scoringSeasonRef.current = scoringSeason;
  hubContextRef.current = hubContext;
  dataRef.current = data;
  selectedPlayerIdRef.current = selectedPlayerId;

  const insightsRefs = useMemo(
    () => ({ capSeasonRef, scoringSeasonRef, historySeasonRef }),
    [],
  );
  const { load: loadInsights, loadCacheRef, prefetchScoring, resetCache } = useInsightsData(leagueId, insightsRefs);
  const insightsHandlers = useMemo(() => ({
    setData,
    setLoading,
    setTabLoading,
    setError,
    setVisiblePositions,
    setScoringSeason,
    setChartHiddenTeams,
    activeTabRef,
    dataRef,
    latestScoringSeasonRef,
    setTeamPick,
    resolveDefaultTeamPick,
    hubContextRef,
  }), []);
  const load = useCallback(
    (opts = {}) => loadInsights(opts, insightsHandlers),
    [loadInsights, insightsHandlers],
  );

  useEffect(() => {
    if (!data?.analytics?.teams?.length || visiblePositions.size > 0) return;
    setVisiblePositions(new Set(resolveAnalyticsPositions(data.analytics)));
  }, [data?.analytics, visiblePositions.size]);

  useEffect(() => {
    if (!leagueId) return;
    loadCacheRef.current.clear();
    const tab = activeTabRef.current || "overview";
    if (tab === "ownership") {
      setLoading(false);
      return;
    }
    const sections = INSIGHTS_TAB_SECTIONS[tab];
    load({ activeTab: tab, sections });
  }, [leagueId, load, loadCacheRef]);

  // Warm Scoring after the landing view paints.
  useEffect(() => {
    if (!leagueId || loading || tabLoading || !data) return;
    if (String(data?.hub_context?.league_id || "") !== String(leagueId)) return;
    let idleId;
    let timeoutId;
    const run = () => prefetchScoring(insightsHandlers);
    if (typeof requestIdleCallback === "function") {
      idleId = requestIdleCallback(run, { timeout: 2500 });
    } else {
      timeoutId = window.setTimeout(run, 700);
    }
    return () => {
      if (idleId != null && typeof cancelIdleCallback === "function") {
        cancelIdleCallback(idleId);
      }
      if (timeoutId != null) window.clearTimeout(timeoutId);
    };
  }, [
    leagueId,
    loading,
    tabLoading,
    data?.hub_context?.league_id,
    prefetchScoring,
    insightsHandlers,
  ]);

  const loadOwnershipHistory = useCallback(async (opts = {}) => {
    if (!leagueId) return null;
    const isSeasonRefresh = Boolean(opts.refresh);
    const generation = ++ownershipGenRef.current;
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
      if (generation !== ownershipGenRef.current) return null;
      const normalized = normalizeOwnershipPayload(payload);
      if (normalized) {
        setOwnershipData(normalized);
        if (!opts.keepSelection) {
          setSelectedPlayerId((prev) => {
            const fromUrl = matchOwnershipPlayer(normalized.players, playerFromUrl);
            return fromUrl?.player_id || prev || normalized.players?.[0]?.player_id || "";
          });
        }
      }
      return normalized;
    } catch (e) {
      if (generation !== ownershipGenRef.current) return null;
      setOwnershipError(connectionErrorMessage(e));
      return null;
    } finally {
      if (generation !== ownershipGenRef.current) return;
      if (isSeasonRefresh) {
        setOwnershipSeasonLoading(false);
      } else {
        setOwnershipLoading(false);
      }
    }
  }, [leagueId, historySeason, playerFromUrl]);

  const ownership = useMemo(
    () => pickOwnershipBlock(ownershipData, data),
    [ownershipData, data],
  );

  useEffect(() => {
    if (prevTabRef.current === activeTab) return;
    prevTabRef.current = activeTab;
    if (activeTab === "ownership") return;
    const sections = INSIGHTS_TAB_SECTIONS[activeTab];
    if (!sections) return;
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
    loadOwnershipHistory({
      keepSelection: Boolean(playerFromUrl) || Boolean(selectedPlayerIdRef.current),
    });
  }, [activeTab, leagueId, historySeason, loadOwnershipHistory]);

  const toggleAwardGroup = useCallback((key) => {
    setAwardGroupToggles((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const onCapSort = useCallback((col) => {
    const next = insightsNextSort(capSortKey, capSortDir, col);
    setCapSortKey(next.sortKey);
    setCapSortDir(next.sortDir);
  }, [capSortKey, capSortDir]);

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
    () => {
      const selected = positions.filter((p) => visiblePositions.has(p));
      return selected.length ? selected : positions;
    },
    [positions, visiblePositions],
  );

  const spendViewMetric = capSeason === "all" ? "pct" : spendMetric;

  const barData = useMemo(() => {
    const teams = data?.analytics?.teams || [];
    const mode = spendViewMetric === "pct" ? "pct" : "dollars";
    const yearSpecific = capSeason === "all" ? false : capSeason !== "current" && /^\d+$/.test(String(capSeason));
    const owners = data?.owner_map || {};
    return teams.map((t) => {
      const row = {
        name: t.display_name || teamDisplayName(t, owners, yearSpecific),
        unspent: mode === "pct" ? t.pct_unspent : t.unspent,
      };
      for (const p of activePositions) {
        row[p] = metricValue(t, p, mode);
      }
      return row;
    });
  }, [data, activePositions, spendViewMetric, capSeason]);

  const pieData = useMemo(() => {
    const teams = data?.analytics?.teams || [];
    const team = teams.find(
      (t) => String(t.team_id) === String(teamPick) || String(t.team_name) === String(teamPick),
    );
    if (!team) return [];
    const mode = spendViewMetric === "pct" ? "pct" : "dollars";
    const slices = activePositions.map((p) => ({
      name: p,
      value: metricValue(team, p, mode === "pct" ? "pct" : "dollars"),
      fill: POS_COLORS[p] || "#94a3b8",
    })).filter((s) => s.value > 0);
    const dead = mode === "pct" ? team.pct_dead_cap : team.dead_cap;
    if (dead > 0) slices.push({ name: "Dead cap", value: dead, fill: "#ef4444" });
    return slices;
  }, [data, teamPick, activePositions, spendViewMetric]);

  const scoringLineData = useMemo(() => {
    const weeks = data?.scoring?.weeks || [];
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
    () => matchOwnershipPlayer(ownership?.players, selectedPlayerId)
      || (ownership?.players || []).find((p) => p.player_id === selectedPlayerId),
    [ownership, selectedPlayerId],
  );

  useEffect(() => {
    if (!playerFromUrl) return;
    setHistorySeason("all");
    const hit = matchOwnershipPlayer(ownership?.players, playerFromUrl);
    if (hit?.player_id) setSelectedPlayerId(hit.player_id);
    else setSelectedPlayerId(playerFromUrl);
  }, [playerFromUrl, ownership]);

  useEffect(() => {
    if (capSeason === "all") {
      setSpendMetric("pct");
      setCapSortKey("pct_committed");
    }
  }, [capSeason]);

  const ownershipPlayerIds = useMemo(() => {
    const ids = new Set();
    filteredPlayers.slice(0, 24).forEach((p) => p.player_id && ids.add(p.player_id));
    if (selectedPlayerId) ids.add(selectedPlayerId);
    return [...ids];
  }, [filteredPlayers, selectedPlayerId]);
  const ownershipPlayerIdsForMedia = activeTab === "ownership" ? ownershipPlayerIds : [];
  const ownershipMedia = usePlayerMedia(ownershipPlayerIdsForMedia);

  const efficiency = data?.efficiency || {};
  const scoringSeasonOptions = useMemo(() => {
    const fromApi = data?.scoring?.available_seasons || [];
    const current = data?.scoring?.season ? [String(data.scoring.season)] : [];
    return [...new Set([...fromApi.map(String), ...current, scoringSeason].filter(Boolean))].sort((a, b) => Number(b) - Number(a));
  }, [data, scoringSeason]);

  const activeScoringSeason = scoringSeason === "current"
    ? (data?.scoring?.requested_season || data?.scoring?.season || "")
    : scoringSeason;
  const scoringAwards = data?.scoring?.awards || data?.scoring_awards || [];
  const showScoringTables = shouldShowScoringTables(data?.scoring);
  const scoringWaiting = scoringWaitingCopy(data?.scoring);
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
  const spendAwardSplit = useMemo(() => featureAwards(spendAwards, 4), [spendAwards]);
  const scoringAwardSplit = useMemo(() => featureAwards(scoringAwards, 4), [scoringAwards]);
  const capHistoryMode = capSeason === "all" ? "all" : capSeason === "current" ? "current" : "year";
  const capHistoryYear = capHistoryMode === "year" ? Number(capSeason) : null;
  const capHistoryLabel = historySeasonLabel(capHistoryMode, capHistoryYear);
  const capYearSpecific = capHistoryMode === "year";
  const allTimeCap = capHistoryMode === "all";
  const spendMetricLocked = allTimeCap ? "pct" : spendMetric;
  const capTeamsRaw = data?.analytics?.teams || [];
  const spendLeaders = useMemo(
    () => positionSpendLeaders(capTeamsRaw, positions, {
      metric: spendMetricLocked === "pct" ? "pct" : "dollars",
      ownerMap,
      yearSpecific: capYearSpecific,
    }),
    [capTeamsRaw, positions, spendMetricLocked, ownerMap, capYearSpecific],
  );
  const discussablePos = useMemo(
    () => pickDiscussablePosition(spendLeaders),
    [spendLeaders],
  );
  const focusedPos = spendLeaders.some((row) => row.position === positionFocus)
    ? positionFocus
    : discussablePos;
  const capPosGetters = useMemo(() => {
    const mode = spendMetricLocked === "pct" ? "pct" : "dollars";
    const getters = {
      committed: (t) => (mode === "pct" ? (t.pct_committed ?? t.committed) : t.committed),
      unspent: (t) => (mode === "pct" ? t.pct_unspent : t.unspent),
      pct_committed: (t) => t.pct_committed ?? Object.values(t.pct_by_position || {}).reduce((s, n) => s + Number(n || 0), 0),
    };
    for (const p of activePositions) {
      getters[`spend_${p}`] = (t) => metricValue(t, p, mode);
    }
    return getters;
  }, [activePositions, spendMetricLocked]);
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
  const scoringStandingsRaw = data?.scoring?.standings || [];
  const scoringRace = useMemo(
    () => scoringRaceRows(scoringStandingsRaw, { ownerMap, yearSpecific: scoringYearSpecific }),
    [scoringStandingsRaw, ownerMap, scoringYearSpecific],
  );
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
  const historyRefresh = ownershipRefreshAffordance(ownership, hubContext);

  const onCapSeasonChange = (next) => {
    setCapSeason(next);
    setTeamPick("");
    setPositionFocus("");
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
      const next = new Set(prev.size ? prev : positions);
      if (next.has(pos)) {
        if (next.size > 1) next.delete(pos);
      } else {
        next.add(pos);
      }
      return next;
    });
  };

  if (loading && !data) {
    return (
      <div className="hub-insights">
        <div className="hub-insights-sticky">
          <HubSegmentNav tabs={insightsTabs} active={activeTab} onChange={setActiveTab} ariaLabel="Insights" />
          <InsightsProgress active />
        </div>
        <HubPage className="hub-spend-page hub-experience-page hub-insights-page">
          <InsightsSkeleton />
        </HubPage>
      </div>
    );
  }

  const tableMode = spendViewMetric === "pct" ? "pct" : "dollars";
  const showCapBarChart = activeTab === "cap" && barData.length > 0;
  const showScoringCharts = activeTab === "scoring" && !tabLoading && data?.scoring?.available;
  const capSeasonBusy = activeTab === "cap" && tabLoading;

  return (
    <div className="hub-insights">
      {data?.draft_recap && (
        <DraftRecapPanel recap={data.draft_recap} />
      )}

      <div className="hub-insights-sticky">
        <HubSegmentNav tabs={insightsTabs} active={activeTab} onChange={setActiveTab} ariaLabel="Insights" />
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

      {error && <div className="error">{error}</div>}

      {activeTab === "overview" && (
        <InsightsOverview
          landing={data?.landing}
          ownerMap={ownerMap}
          loading={loading || tabLoading}
          onOpenTab={setActiveTab}
          isCommissioner={isCommissioner}
          awardCatalog={data?.award_catalog || data?.landing?.award_catalog}
          currentRules={hubContext?.rules}
          onRulesSaved={(updated) => {
            resetCache();
            onWorkspaceSaved?.(updated);
            load({ activeTab: "overview", sections: "overview", refresh: true });
          }}
        />
      )}

      {activeTab === "cap" && (
        <HubPage className="hub-spend-page hub-experience-page hub-insights-page">
          <HubExperienceHero
            eyebrow="Insights"
            heading="Who spent the cap."
            support="Positional spend, outliers, and who is out of room. Awards first — charts wait until you want them."
            chip={capHistoryLabel}
          >
            {insightsHeroStatus(spendAwardSplit.featured) ? (
              <p className="hub-experience-hero-status">{insightsHeroStatus(spendAwardSplit.featured)}</p>
            ) : null}
          </HubExperienceHero>

          <div className="hub-insights-toolbar">
            <InsightsSeasonBar
              value={capSeason}
              seasons={historic.seasons}
              historic={historic}
              onChange={onCapSeasonChange}
              disabled={loading}
              label="Cap season"
              className="hub-insights-season-bar--spend"
            />
            {!allTimeCap && (
            <div className="hub-insights-controls">
              <span className="hub-filter-label">Show as</span>
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
            )}
            {allTimeCap && (
              <p className="hub-insights-alltime-note">
                All-time view is managers, not franchise names. Spend is the average share of each season’s cap.
              </p>
            )}
          </div>

          {capSeasonBusy && !barData.length && <InsightsSkeleton />}

          <FeaturedAwards
            awards={spendAwardSplit.featured}
            ownerMap={ownerMap}
            yearSpecific={capYearSpecific}
            subtitle={`${usingHistoricCap ? capHistoryLabel : "Current rosters"}${allTimeCap ? " · avg % of cap" : ""}`}
          />

          <PositionSpendBoard
            leaders={spendLeaders}
            focusedPos={focusedPos}
            onFocus={setPositionFocus}
            metric={spendViewMetric}
            mineId={hubContext?.team_id}
            mineName={hubContext?.team_name}
            allTime={allTimeCap}
          />

          {spendAwardSplit.rest.length > 0 && (
            <InsightsDisclosure
              summary={`More awards (${spendAwardSplit.rest.length})`}
              meta="The rest of the list"
            >
              <MoreAwards
                awards={spendAwardSplit.rest}
                ownerMap={ownerMap}
                yearSpecific={capYearSpecific}
                visibleGroups={awardGroupToggles}
                onToggleGroup={toggleAwardGroup}
              />
            </InsightsDisclosure>
          )}

          {showCapBarChart && (
            <InsightsDisclosure
              summary="Compare stacked spend"
              meta="Optional charts"
              onOpen={() => setCapChartsOpen(true)}
            >
              <div className="hub-insights-pos-filter">
                <span className="hub-filter-label">Positions</span>
                <HubFilterScroll>
                  {positions.map((p) => (
                    <HubFilterChip
                      key={p}
                      active={visiblePositions.size === 0 || visiblePositions.has(p)}
                      onClick={() => togglePosition(p)}
                      accentColor={POS_COLORS[p]}
                    >
                      {p}
                    </HubFilterChip>
                  ))}
                </HubFilterScroll>
              </div>
              {capChartsOpen && (
                <Suspense fallback={<ChartFallback />}>
                  <InsightsCharts
                    kind="cap"
                    barData={barData}
                    pieData={pieData}
                    teams={data?.analytics?.teams || []}
                    teamPick={teamPick}
                    onTeamPick={setTeamPick}
                    activePositions={activePositions}
                    spendMetric={spendViewMetric}
                    capSeason={capSeason}
                    chartXTick={chartXTick}
                    chartBottomMargin={chartBottomMargin}
                    mobileLayout={mobileLayout}
                  />
                </Suspense>
              )}
            </InsightsDisclosure>
          )}

          <InsightsDisclosure
            summary="Full league table"
            meta={`${capTeamsRaw.length} ${allTimeCap ? "manager" : "team"}${capTeamsRaw.length === 1 ? "" : "s"} · optional detail`}
          >
            <div className="hub-table-card hub-insights-table-wrap">
              <h3 className="hub-panel-subtitle hub-insights-table-title">
                {allTimeCap ? "Manager breakdown" : "Team breakdown"}
              </h3>
              <InsightsTableToolbar
                search={capTeamFilter}
                onSearchChange={setCapTeamFilter}
                placeholder={allTimeCap ? "Filter managers…" : "Filter teams…"}
                count={filteredCapTeams.length}
                total={capTeamsRaw.length}
                noun={allTimeCap ? "managers" : "teams"}
              />
              {mobileLayout ? (
                <MobileDataList>
                  {filteredCapTeams.map((t) => (
                    <MobilePlayerCard
                      key={t.team_id}
                      name={teamDisplayName(t, ownerMap, capYearSpecific)}
                      meta={allTimeCap
                        ? `${t.seasons_tracked || 0} seasons`
                        : `${fmtSal(t.unspent)} unspent`}
                      heroValue={allTimeCap
                        ? formatSpendValue(t.pct_committed ?? 0, "pct")
                        : fmtSal(t.committed)}
                      heroLabel={allTimeCap ? "avg cap" : "committed"}
                      expanded={(
                        <div className="mobile-stat-grid">
                          {activePositions.map((p) => (
                            <MobileStat
                              key={p}
                              label={`${p} ${tableMode === "pct" ? "%" : "$"}`}
                              value={(
                                <>
                                  {formatSpendValue(metricValue(t, p, tableMode), tableMode)}
                                  {tableMode === "dollars" && t.pct_by_position?.[p] != null && (
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
                        <SortTh label={allTimeCap ? "Manager" : "Team"} col="team" sortKey={capSortKey} sortDir={capSortDir} onSort={onCapSort} />
                        {activePositions.map((p) => (
                          <SortTh
                            key={p}
                            label={`${p} ${tableMode === "pct" ? "%" : "$"}`}
                            col={`spend_${p}`}
                            sortKey={capSortKey}
                            sortDir={capSortDir}
                            onSort={onCapSort}
                          />
                        ))}
                        {allTimeCap ? (
                          <>
                            <SortTh label="Avg cap %" col="pct_committed" sortKey={capSortKey} sortDir={capSortDir} onSort={onCapSort} />
                            <SortTh label="Avg leftover" col="unspent" sortKey={capSortKey} sortDir={capSortDir} onSort={onCapSort} />
                          </>
                        ) : (
                          <>
                            <SortTh label="Committed" col="committed" sortKey={capSortKey} sortDir={capSortDir} onSort={onCapSort} />
                            <SortTh label="Unspent" col="unspent" sortKey={capSortKey} sortDir={capSortDir} onSort={onCapSort} />
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredCapTeams.map((t) => (
                        <tr key={t.team_id}>
                          <td>{teamDisplayName(t, ownerMap, capYearSpecific)}</td>
                          {activePositions.map((p) => (
                            <td key={p}>
                              {formatSpendValue(metricValue(t, p, tableMode), tableMode)}
                              {tableMode === "dollars" && t.pct_by_position?.[p] != null && (
                                <span className="table-meta"> ({t.pct_by_position[p]}%)</span>
                              )}
                            </td>
                          ))}
                          {allTimeCap ? (
                            <>
                              <td>{formatSpendValue(t.pct_committed ?? 0, "pct")}</td>
                              <td>{formatSpendValue(t.pct_unspent ?? 0, "pct")}</td>
                            </>
                          ) : (
                            <>
                              <td>{fmtSal(t.committed)}</td>
                              <td>{fmtSal(t.unspent)}</td>
                            </>
                          )}
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
          </InsightsDisclosure>
        </HubPage>
      )}

      {activeTab === "scoring" && (
        <HubPage className="hub-insights-scoring hub-spend-page hub-experience-page hub-insights-page">
          <HubExperienceHero
            eyebrow="Scoring"
            heading="Who’s actually scoring."
            support="Superlatives and the points race first. The weekly chart stays out of the way until you open it."
            chip={data?.scoring?.available ? scoringSeasonLabel : "Sleeper"}
          >
            {insightsHeroStatus(scoringAwardSplit.featured) ? (
              <p className="hub-experience-hero-status">{insightsHeroStatus(scoringAwardSplit.featured)}</p>
            ) : null}
          </HubExperienceHero>

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

          {data?.scoring?.available && !data?.scoring?.preseason && scoringAwards.length > 0 && showScoringTables && (
            <>
              <FeaturedAwards
                awards={scoringAwardSplit.featured}
                ownerMap={ownerMap}
                yearSpecific={scoringYearSpecific}
                title="Scoring awards"
                subtitle={scoringSeasonLabel}
              />
              {scoringAwardSplit.rest.length > 0 && (
                <InsightsDisclosure
                  summary={`More awards (${scoringAwardSplit.rest.length})`}
                  meta="The rest of the season"
                >
                  <MoreAwards
                    awards={scoringAwardSplit.rest}
                    ownerMap={ownerMap}
                    yearSpecific={scoringYearSpecific}
                    visibleGroups={awardGroupToggles}
                    onToggleGroup={toggleAwardGroup}
                  />
                </InsightsDisclosure>
              )}
            </>
          )}

          {data?.scoring?.available && !data?.scoring?.preseason && scoringAwards.length === 0 && showScoringTables && (
            <p className="chart-note hub-insights-callout">
              {tabLoading ? "Loading awards…" : "Awards still loading — tap Refresh from Sleeper."}
            </p>
          )}

          {data?.scoring?.available && !showScoringTables && (
            <div className="hub-insights-empty-state">
              <h3>{scoringWaiting.title}</h3>
              <p>{scoringWaiting.body}</p>
            </div>
          )}

          {data?.scoring?.available && showScoringTables && (
            <>
              <ScoringRace
                rows={scoringRace}
                mineId={hubContext?.team_id}
                mineName={hubContext?.team_name}
                onHover={setChartHoveredTeam}
                hoveredName={chartHoveredTeam}
                hiddenTeams={chartHiddenTeams}
                onToggleTeam={toggleChartTeam}
              />

              {showScoringCharts && scoringLineData.length > 0 && chartVisibleTeams.length > 0 ? (
                <InsightsDisclosure
                  summary="Weekly race chart"
                  meta="Optional"
                  onOpen={() => setScoringChartsOpen(true)}
                >
                  {scoringChartsOpen && (
                    <Suspense fallback={<ChartFallback />}>
                      <InsightsCharts
                        kind="scoring"
                        data={scoringLineData}
                        teams={chartVisibleTeams}
                        colorByTeam={scoringColorByTeam}
                        dashByTeam={scoringDashByTeam}
                        hoveredTeam={chartHoveredTeam}
                        onHover={setChartHoveredTeam}
                        onLegendClick={handleLegendClick}
                        chartXTick={chartXTick}
                        chartBottomMargin={chartBottomMargin}
                        mobileLayout={mobileLayout}
                      />
                    </Suspense>
                  )}
                </InsightsDisclosure>
              ) : showScoringCharts && scoringLineData.length > 0 ? (
                <p className="chart-note hub-insights-chart-placeholder">
                  All teams hidden — tap a row in the race to show lines again.
                </p>
              ) : (
                <p className="chart-note hub-insights-chart-placeholder">
                  Weekly chart appears after the first scored week in Sleeper.
                </p>
              )}

              <InsightsDisclosure
                summary="Standings table"
                meta={`${scoringStandingsRaw.length} teams`}
              >
                <div className="hub-table-card hub-insights-table-wrap">
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
              </InsightsDisclosure>

              {efficiency?.available && (efficiency.teams || []).length > 0 && (
                <InsightsDisclosure
                  summary="Cap efficiency"
                  meta={efficiency.season ? String(efficiency.season) : "pts per $"}
                >
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
                </InsightsDisclosure>
              )}
            </>
          )}
        </HubPage>
      )}

      {activeTab === "ownership" && (
        <HubPage className="hub-player-history-page hub-experience-page hub-insights-page">
          <HubExperienceHero
            eyebrow="History"
            heading="Follow a player through the league."
            support="Contracts, owners, and the timeline that started the argument."
            chip={historyLabel}
          />
          <header className="hub-section-head hub-section-head--row">
            <div>
              <p className="hub-section-hint">
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
                className={`${historyRefresh.emphasize ? "btn-primary" : "btn-ghost"} btn-sm`}
                disabled={
                  !historyRefresh.canRefresh
                  || ownershipLoading
                  || ownershipSeasonLoading
                }
                title={historyRefresh.disabledReason || undefined}
                onClick={() => loadOwnershipHistory({ refresh: true, keepSelection: true })}
              >
                {ownershipSeasonLoading
                  ? "Loading…"
                  : historyRefresh.buttonLabel}
              </button>
            </div>
          </header>
          {ownershipError && <p className="chart-note error">{ownershipError}</p>}
          {historyRefresh.showHint && (
            <p className="chart-note hub-insights-scoring-hint">{historyRefresh.showHint}</p>
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
              {!selectedPlayer && playerFromUrl && (
                <p className="chart-note">
                  No contract history for this player in the selected seasons.
                </p>
              )}
              {!selectedPlayer && !playerFromUrl && (
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

    </div>
  );
}
