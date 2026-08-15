import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "./AuthContext";
import DraftTable from "./DraftTable";
import DraftHub from "./DraftHub/DraftHub";
import HubSubnav, { HUB_SUBVIEWS } from "./DraftHub/HubSubnav";
import DfsOptimizer from "./LineupOptimizer";
import SeasonTable from "./SeasonTable";
import SeasonTransitionState from "./SeasonTransitionState";
import InjurySidebar from "./InjurySidebar";
import SentimentPanel from "./SentimentPanel";
import WeeklyTable from "./WeeklyTable";
import PlayerCompare, { MAX_COMPARE as MAX_COMPARE_PLAYERS } from "./PlayerCompare";
import useAccuracyRebuildPoll from "./useAccuracyRebuildPoll";
import useAppNavigation from "./useAppNavigation";
import useMobileLayout from "./useMobileLayout";
import useProjectionsMeta from "./hooks/useProjectionsMeta";
import InviteAccept from "./InviteAccept";
import VerifyEmailBanner from "./VerifyEmailBanner";
import InstallPrompt from "./InstallPrompt";
import TermsReacceptBanner from "./TermsReacceptBanner";
import LegalLinks from "./LegalLinks";
import { PRODUCT_DISCLAIMER } from "./auth";
import AdminPortal from "./AdminPortal";
import MobileShell from "./layout/MobileShell";
import MobileHeader from "./layout/MobileHeader";
import MobileSubnav from "./layout/MobileSubnav";
import MobileFilterSheet from "./layout/MobileFilterSheet";
import ProjectionsFilterBar, { PROJECTION_POSITIONS } from "./layout/ProjectionsFilterBar";
import MobileMenuSheet from "./layout/MobileMenuSheet";
import UserMenu from "./layout/UserMenu";
import {
  APP_SECTIONS,
  PROJECTIONS_TABS,
  SEASON_MODES,
  SECTION_SUBTITLES,
  TOOLS_TABS,
  defaultSeasonMode,
  resolveSectionLabel,
} from "./appNavigation";
import { apiFetch } from "./auth";
import { isAbortError } from "./fetchAbort";
import {
  connectionErrorMessage,
  formatRelativeTime,
  parseApiError,
} from "./format";
import { playerSentimentKey, buildSentimentMap, resolveRowSentiment } from "./sentimentDisplay";
import { PRODUCT_NAME, STUDIO_NAME } from "./brand";
import { PlayerCardProvider } from "./PlayerCardContext";

const AccuracyChart = lazy(() => import("./AccuracyChart"));

const POSITIONS = PROJECTION_POSITIONS;

export default function App() {
  const {
    ready: authReady,
    authenticated,
    user,
    openSignIn,
    logout: authLogout,
    hubAuthRequired,
    refreshAuth,
    termsUrl,
    privacyUrl,
  } = useAuth();
  const mobileLayout = useMobileLayout();
  const nav = useAppNavigation();
  const routerNavigate = useNavigate();
  const {
    view,
    projectionsTab,
    projectionsMobilePanel,
    seasonMode,
    seasonMobilePanel,
    toolsTab,
    hubSubView,
    insightTab,
    adminTab,
    filtersFromUrl,
    goToSection,
    setProjectionsTab,
    setProjectionsMobilePanel,
    setSeasonMode,
    setSeasonMobilePanel,
    setToolsTab,
    setHubSubView,
    updateFilters,
    setAdminTab,
  } = nav;
  const [hubContext, setHubContext] = useState(null);
  const [compareIds, setCompareIds] = useState(() => filtersFromUrl.compareIds || []);
  const [compareViewOpen, setCompareViewOpen] = useState(
    () => Boolean(filtersFromUrl.compareView && (filtersFromUrl.compareIds || []).length >= 2),
  );
  const [compareMetaById, setCompareMetaById] = useState({});
  const [position, setPosition] = useState(filtersFromUrl.position || "qb");
  const [movementFilter, setMovementFilter] = useState(
    () => filtersFromUrl.movementFilter || "all",
  );
  const [projections, setProjections] = useState([]);
  const [rosProjections, setRosProjections] = useState([]);
  const [rosMeta, setRosMeta] = useState(null);
  const [draftProjections, setDraftProjections] = useState([]);
  const [draftResponseMeta, setDraftResponseMeta] = useState(null);
  const [meta, setMeta] = useState(null);
  const [refreshStatus, setRefreshStatus] = useState(null);
  const [accuracyReport, setAccuracyReport] = useState(null);
  const [upsideReport, setUpsideReport] = useState(null);
  const [seasonLongReport, setSeasonLongReport] = useState(null);
  const [accuracyLoading, setAccuracyLoading] = useState(false);
  const [accuracyError, setAccuracyError] = useState("");
  const [accuracyRebuildPhase, setAccuracyRebuildPhase] = useState("idle");
  const [projectionsLoading, setProjectionsLoading] = useState(false);
  const [draftLoading, setDraftLoading] = useState(false);
  const [rosLoading, setRosLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const {
    projMeta,
    draftMeta,
    season,
    setSeason,
    week,
    setWeek,
    rosSeason,
    setRosSeason,
    rosFromWeek,
    setRosFromWeek,
    draftSeason,
    setDraftSeason,
    projMetaRef,
    weekOptions,
    rosWeekOptions,
    isLiveContext,
    fetchProjMeta,
    fetchDraftMeta,
  } = useProjectionsMeta();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTeams, setSelectedTeams] = useState([]);
  const [allInjuries, setAllInjuries] = useState([]);
  const [subtitleDisplay, setSubtitleDisplay] = useState(SECTION_SUBTITLES.projections.weekly);
  const [subtitleFading, setSubtitleFading] = useState(false);
  const [sentimentPlayers, setSentimentPlayers] = useState([]);
  const [sentimentMeta, setSentimentMeta] = useState(null);
  const [sentimentLoading, setSentimentLoading] = useState(false);
  const [sentimentError, setSentimentError] = useState("");
  const [seasonSentimentPlayers, setSeasonSentimentPlayers] = useState([]);
  const [seasonSentimentMeta, setSeasonSentimentMeta] = useState(null);
  const [seasonSentimentLoading, setSeasonSentimentLoading] = useState(false);
  const [seasonSentimentError, setSeasonSentimentError] = useState("");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileFilterOpen, setMobileFilterOpen] = useState(false);
  const [hubMounted, setHubMounted] = useState(false);
  const rosFetchGen = useRef(0);
  const seasonModeUserPicked = useRef(false);

  const isWeeklyProjections = view === "projections" && projectionsTab === "weekly";
  const isSeasonPreseason = view === "projections" && projectionsTab === "season" && seasonMode === "preseason";
  const isSeasonLive = view === "projections" && projectionsTab === "season" && seasonMode === "live";
  const isProjectionsDataView = isWeeklyProjections || isSeasonPreseason || isSeasonLive;

  const fetchDraft = useCallback(async (signal) => {
    if (draftSeason == null) return;
    setDraftLoading(true);
    setError("");
    try {
      const res = await apiFetch(`/api/draft/${position}?season=${draftSeason}`, { signal });
      if (!res.ok) throw new Error(await parseApiError(res, "Failed to load draft projections"));
      const data = await res.json();
      if (signal?.aborted) return;
      setDraftProjections(data.projections || []);
      setDraftResponseMeta(data.meta || null);
    } catch (err) {
      if (isAbortError(err)) return;
      setDraftProjections([]);
      setDraftResponseMeta(null);
      setError(connectionErrorMessage(err, "Failed to load draft projections"));
    } finally {
      setDraftLoading(false);
    }
  }, [position, draftSeason]);

  const fetchProjections = useCallback(async (signal, override = null) => {
    const targetSeason = override?.season ?? season;
    const targetWeek = override?.week ?? week;
    const meta = override?.projMeta ?? projMetaRef.current;
    if (targetSeason == null || targetWeek == null) return;
    const live =
      meta != null && targetSeason === meta.default_season && targetWeek === meta.default_week;
    setProjectionsLoading(true);
    setError("");
    try {
      const res = await apiFetch(
        `/api/predict/${position}?season=${targetSeason}&week=${targetWeek}&apply_injury_adjustments=${live}`,
        { signal },
      );
      if (!res.ok) throw new Error(await parseApiError(res, "Failed to load projections"));
      const data = await res.json();
      if (signal?.aborted) return;
      setProjections(data.projections || []);
      setMeta(data.meta || null);
    } catch (err) {
      if (isAbortError(err)) return;
      setProjections([]);
      setMeta(null);
      setError(connectionErrorMessage(err, "Failed to load projections"));
    } finally {
      setProjectionsLoading(false);
    }
  }, [position, season, week]);

  const fetchSentiment = useCallback(async (signal, override = null) => {
    const targetSeason = override?.season ?? season;
    const targetWeek = override?.week ?? week;
    if (targetSeason == null || targetWeek == null) return;
    setSentimentLoading(true);
    setSentimentError("");
    try {
      const res = await apiFetch(
        `/api/fantasy-narrative/${position}/weekly?season=${targetSeason}&week=${targetWeek}`,
        { signal },
      );
      if (!res.ok) throw new Error(await parseApiError(res, "Failed to load fantasy weekly narrative"));
      const data = await res.json();
      if (signal?.aborted) return;
      setSentimentPlayers(data.players || []);
      setSentimentMeta({
        ...(data.meta || {}),
        season: data.season,
        week: data.week,
        requested_season: data.requested_season,
        requested_week: data.requested_week,
        context_fallback: data.context_fallback,
        count: data.count,
      });
    } catch (err) {
      if (isAbortError(err)) return;
      setSentimentPlayers([]);
      setSentimentMeta(null);
      setSentimentError(connectionErrorMessage(err, "Failed to load fantasy weekly narrative"));
    } finally {
      setSentimentLoading(false);
    }
  }, [position, season, week]);

  const fetchSeasonSentiment = useCallback(async (signal, override = null) => {
    const targetSeason = override?.season ?? rosSeason ?? season;
    const targetWeek = override?.week ?? rosFromWeek ?? week;
    if (targetSeason == null || targetWeek == null) return;
    setSeasonSentimentLoading(true);
    setSeasonSentimentError("");
    try {
      const res = await apiFetch(
        `/api/fantasy-narrative/${position}/season?season=${targetSeason}&week=${targetWeek}`,
        { signal },
      );
      if (!res.ok) throw new Error(await parseApiError(res, "Failed to load fantasy season narrative"));
      const data = await res.json();
      if (signal?.aborted) return;
      setSeasonSentimentPlayers(data.players || []);
      setSeasonSentimentMeta({
        ...(data.meta || {}),
        scope: data.scope,
        season: data.season,
        week: data.week,
        requested_season: data.requested_season,
        requested_week: data.requested_week,
        context_fallback: data.context_fallback,
        count: data.count,
      });
    } catch (err) {
      if (isAbortError(err)) return;
      setSeasonSentimentPlayers([]);
      setSeasonSentimentMeta(null);
      setSeasonSentimentError(connectionErrorMessage(err, "Failed to load fantasy season narrative"));
    } finally {
      setSeasonSentimentLoading(false);
    }
  }, [position, rosSeason, rosFromWeek, season, week]);

  const fetchRos = useCallback(async (signal) => {
    if (rosSeason == null || rosFromWeek == null) return;
    const meta = projMetaRef.current;
    const gen = ++rosFetchGen.current;
    setRosLoading(true);
    setError("");
    try {
      const liveRos =
        meta != null &&
        rosSeason === meta.default_season &&
        rosFromWeek === meta.default_week &&
        meta.default_week <= 18;
      const res = await apiFetch(
        `/api/ros/${position}?season=${rosSeason}&week=${rosFromWeek}&apply_injury_adjustments=${liveRos}`,
        { signal },
      );
      if (!res.ok) throw new Error(await parseApiError(res, "Failed to load season projections"));
      const data = await res.json();
      if (signal?.aborted || gen !== rosFetchGen.current) return;
      setRosProjections(data.projections || []);
      setRosMeta(data.meta || null);
    } catch (err) {
      if (isAbortError(err) || gen !== rosFetchGen.current) return;
      setRosProjections([]);
      setRosMeta(null);
      setError(connectionErrorMessage(err, "Failed to load season projections"));
    } finally {
      if (gen === rosFetchGen.current) {
        setRosLoading(false);
      }
    }
  }, [position, rosSeason, rosFromWeek]);

  const fetchAccuracy = useCallback(async () => {
    setAccuracyLoading(true);
    setAccuracyError("");
    setAccuracyReport(null);
    setUpsideReport(null);
    setSeasonLongReport(null);
    try {
      const accRes = await apiFetch(`/api/accuracy?position=${position}`);
      if (!accRes.ok) {
        throw new Error(await parseApiError(accRes, "Accuracy report unavailable"));
      }
      setAccuracyReport(await accRes.json());
      try {
        const upRes = await apiFetch(`/api/upside?position=${position}`);
        if (upRes.ok) {
          setUpsideReport(await upRes.json());
        }
      } catch {
        setUpsideReport(null);
      }
      try {
        const slRes = await apiFetch(`/api/accuracy/season-long?position=${position}`);
        if (slRes.ok) {
          setSeasonLongReport(await slRes.json());
        }
      } catch {
        setSeasonLongReport(null);
      }
    } catch (err) {
      setAccuracyReport(null);
      setUpsideReport(null);
      setSeasonLongReport(null);
      setAccuracyError(connectionErrorMessage(err, "Failed to load accuracy report"));
    } finally {
      setAccuracyLoading(false);
    }
  }, [position]);

  const syncAccuracyRebuildStatus = useCallback(async () => {
    try {
      const res = await apiFetch("/api/accuracy/status");
      if (!res.ok) return;
      const data = await res.json();
      if (data.is_building) {
        setAccuracyRebuildPhase("building");
        return;
      }
      if (data.error) {
        setAccuracyRebuildPhase("error");
        setAccuracyError(data.error);
        return;
      }
      if (data.ready_to_load) {
        setAccuracyRebuildPhase("ready");
        return;
      }
      setAccuracyRebuildPhase("idle");
    } catch {
      /* optional during dev */
    }
  }, []);

  const loadFreshAccuracy = useCallback(async () => {
    setAccuracyError("");
    await fetchAccuracy();
    try {
      await apiFetch("/api/accuracy/rebuild/ack", { method: "POST" });
    } catch {
      /* non-fatal */
    }
    setAccuracyRebuildPhase("idle");
  }, [fetchAccuracy]);

  useAccuracyRebuildPoll({
    active: view === "model" && accuracyRebuildPhase === "building",
    onReady: () => setAccuracyRebuildPhase("ready"),
    onError: (message) => {
      setAccuracyRebuildPhase("error");
      setAccuracyError(message || "Accuracy rebuild failed");
    },
  });

  const seasonComplete = useMemo(() => {
    if (rosMeta?.season_complete != null) return Boolean(rosMeta.season_complete);
    if (rosMeta?.weeks_remaining != null) return Number(rosMeta.weeks_remaining) === 0;
    const first = rosProjections[0];
    return first ? Number(first["Weeks Remaining"]) === 0 : false;
  }, [rosMeta, rosProjections]);

  const headerSubtitle = useMemo(() => {
    if (view === "projections") {
      if (projectionsTab === "weekly") return SECTION_SUBTITLES.projections.weekly;
      return SECTION_SUBTITLES.projections.season[seasonMode] || "";
    }
    if (view === "hub") return SECTION_SUBTITLES.hub[hubSubView] || "";
    if (view === "tools") return SECTION_SUBTITLES.tools[toolsTab] || "";
    if (view === "model") return SECTION_SUBTITLES.model;
    if (view === "admin") return SECTION_SUBTITLES.admin;
    return "";
  }, [view, projectionsTab, seasonMode, toolsTab, hubSubView]);

  /** Offseason empty slate after week 18 — not a generic loading state. */
  const seasonTransition = useMemo(() => {
    if (!isSeasonLive) return false;
    if (error) return false;
    if (rosLoading) return false;
    const afterWeek18 = projMeta != null && Number(projMeta.default_week) > 18;
    return afterWeek18 && rosProjections.length === 0;
  }, [isSeasonLive, rosLoading, rosProjections, projMeta, error]);

  const seasonRefreshing = isSeasonLive && rosLoading && rosProjections.length > 0;
  const seasonLoading = isSeasonLive && rosLoading && rosProjections.length === 0 && !error;

  const fetchMeta = useCallback(async () => {
    try {
      const [injRes, statusRes] = await Promise.all([
        apiFetch("/api/injuries"),
        apiFetch("/api/refresh/status"),
      ]);
      if (injRes.ok) {
        const inj = await injRes.json();
        setAllInjuries(inj.players || []);
      }
      if (statusRes.ok) {
        setRefreshStatus(await statusRes.json());
      }
    } catch {
      /* optional during dev */
    }
  }, []);

  const contextualTeams = useMemo(() => {
    if (selectedTeams.length) return selectedTeams;
    const fromTable = [...new Set((projections || []).map((r) => r.Team).filter(Boolean))];
    return fromTable.sort();
  }, [selectedTeams, projections]);

  const sidebarInjuries = useMemo(() => {
    const posMap = { qb: new Set(["QB"]), rb: new Set(["RB", "FB"]), wr: new Set(["WR", "TE"]) };
    const allowedPos = posMap[position] || null;
    const teamSet = contextualTeams.length ? new Set(contextualTeams.map((t) => t.toUpperCase())) : null;
    const q = (searchQuery || "").trim().toLowerCase();

    return (allInjuries || []).filter((p) => {
      if (allowedPos && !allowedPos.has(p.position)) return false;
      if (teamSet && !teamSet.has(String(p.team || "").toUpperCase())) return false;
      if (q && !String(p.full_name || "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [allInjuries, contextualTeams, position, searchQuery]);

  const sentimentByPlayer = useMemo(
    () => buildSentimentMap(sentimentPlayers),
    [sentimentPlayers]
  );

  const seasonSentimentByPlayer = useMemo(
    () => buildSentimentMap(seasonSentimentPlayers),
    [seasonSentimentPlayers]
  );

  const tableRows = useMemo(() => {
    if (!isLiveContext) {
      return projections.map((row) => ({
        ...row,
        sentiment: resolveRowSentiment(sentimentByPlayer, row),
      }));
    }
    const lookup = new Map(
      (allInjuries || []).map((p) => [
        `${String(p.full_name).toLowerCase()}|${String(p.team).toUpperCase()}`,
        p.injury_status,
      ])
    );
    return projections.map((row) => {
      const key = playerSentimentKey(row.Player, row.Team);
      return {
        ...row,
        "Injury Status": row["Injury Status"] || lookup.get(key) || "",
        sentiment: resolveRowSentiment(sentimentByPlayer, row),
      };
    });
  }, [projections, allInjuries, isLiveContext, sentimentByPlayer]);

  const rosTableRows = useMemo(
    () => rosProjections.map((row) => ({
      ...row,
      sentiment: resolveRowSentiment(seasonSentimentByPlayer, row),
    })),
    [rosProjections, seasonSentimentByPlayer],
  );

  useEffect(() => {
    const controller = new AbortController();
    fetchProjMeta(position, controller.signal);
    fetchDraftMeta(position, controller.signal);
    setSelectedTeams([]);
    setSearchQuery("");
    seasonModeUserPicked.current = false;
    return () => controller.abort();
  }, [position, fetchProjMeta, fetchDraftMeta]);

  useEffect(() => {
    if (filtersFromUrl.position && filtersFromUrl.position !== position) {
      setPosition(filtersFromUrl.position);
    }
  }, [filtersFromUrl.position]);

  useEffect(() => {
    if (filtersFromUrl.season != null) setSeason(filtersFromUrl.season);
  }, [filtersFromUrl.season]);

  useEffect(() => {
    if (filtersFromUrl.week != null) setWeek(filtersFromUrl.week);
  }, [filtersFromUrl.week]);

  useEffect(() => {
    if (filtersFromUrl.selectedTeams) setSelectedTeams(filtersFromUrl.selectedTeams);
  }, [filtersFromUrl.selectedTeams]);

  useEffect(() => {
    if (filtersFromUrl.movementFilter != null) {
      setMovementFilter(filtersFromUrl.movementFilter);
    }
  }, [filtersFromUrl.movementFilter]);

  useEffect(() => {
    if (filtersFromUrl.draftSeason != null) setDraftSeason(filtersFromUrl.draftSeason);
  }, [filtersFromUrl.draftSeason]);

  useEffect(() => {
    if (filtersFromUrl.rosFromWeek != null) setRosFromWeek(filtersFromUrl.rosFromWeek);
  }, [filtersFromUrl.rosFromWeek]);

  useEffect(() => {
    if (filtersFromUrl.rosSeason != null) setRosSeason(filtersFromUrl.rosSeason);
  }, [filtersFromUrl.rosSeason]);

  const syncFiltersToUrl = useCallback(
    (overrides = {}) => {
      updateFilters({
        position: overrides.position ?? position,
        season: overrides.season ?? season,
        week: overrides.week ?? week,
        selectedTeams: overrides.selectedTeams ?? selectedTeams,
        draftSeason: overrides.draftSeason ?? draftSeason,
        rosSeason: overrides.rosSeason ?? rosSeason,
        rosFromWeek: overrides.rosFromWeek ?? rosFromWeek,
        search: overrides.search ?? searchQuery,
        compareIds: overrides.compareIds ?? compareIds,
        compareView: overrides.compareView ?? compareViewOpen,
        movementFilter: overrides.movementFilter ?? movementFilter,
      });
    },
    [
      updateFilters,
      position,
      season,
      week,
      selectedTeams,
      draftSeason,
      rosSeason,
      rosFromWeek,
      searchQuery,
      compareIds,
      compareViewOpen,
      movementFilter,
    ],
  );

  const compareSelectionMeta = useMemo(
    () =>
      compareIds.map((id) => compareMetaById[id] || { player_id: id, name: id }),
    [compareIds, compareMetaById],
  );

  const handleToggleCompare = useCallback(
    (row) => {
      const id = row?.player_id != null ? String(row.player_id) : "";
      if (!id) return;
      const has = compareIds.includes(id);
      if (!has && compareIds.length >= MAX_COMPARE_PLAYERS) return;
      const next = has ? compareIds.filter((x) => x !== id) : [...compareIds, id];
      if (!has) {
        setCompareMetaById((meta) => ({
          ...meta,
          [id]: {
            player_id: id,
            name: row.Player || id,
            position: row.Position || position,
            team: row.Team || "",
          },
        }));
      }
      const stillOpen = compareViewOpen && next.length >= 2;
      setCompareIds(next);
      if (!stillOpen && compareViewOpen) setCompareViewOpen(false);
      syncFiltersToUrl({ compareIds: next, compareView: stillOpen });
    },
    [compareIds, compareViewOpen, position, syncFiltersToUrl],
  );

  const handleOpenCompare = useCallback(() => {
    if (compareIds.length < 2) return;
    setCompareViewOpen(true);
    syncFiltersToUrl({ compareIds, compareView: true });
  }, [compareIds, syncFiltersToUrl]);

  const handleCloseCompare = useCallback(() => {
    setCompareViewOpen(false);
    syncFiltersToUrl({ compareIds, compareView: false });
  }, [compareIds, syncFiltersToUrl]);

  const handleClearCompare = useCallback(() => {
    setCompareIds([]);
    setCompareViewOpen(false);
    setCompareMetaById({});
    syncFiltersToUrl({ compareIds: [], compareView: false });
  }, [syncFiltersToUrl]);

  const handleRemoveComparePlayer = useCallback(
    (playerId) => {
      const id = String(playerId || "");
      if (!id) return;
      const next = compareIds.filter((x) => x !== id);
      const stillOpen = next.length >= 2;
      setCompareIds(next);
      if (!stillOpen) setCompareViewOpen(false);
      syncFiltersToUrl({ compareIds: next, compareView: stillOpen });
    },
    [compareIds, syncFiltersToUrl],
  );

  // Browser back/forward + shared deep-links for start/sit selection.
  useEffect(() => {
    const fromUrl = filtersFromUrl.compareIds || [];
    setCompareIds((prev) => {
      const fromUrlKey = fromUrl.join(",");
      return fromUrlKey !== prev.join(",") ? fromUrl : prev;
    });
    setCompareViewOpen(Boolean(filtersFromUrl.compareView && fromUrl.length >= 2));
  }, [filtersFromUrl.compareIds, filtersFromUrl.compareView]);

  const handlePositionChange = useCallback(
    (pos) => {
      setPosition(pos);
      setSearchQuery("");
      syncFiltersToUrl({ position: pos, search: "" });
    },
    [syncFiltersToUrl],
  );

  const clearTableFilters = useCallback(() => {
    setSearchQuery("");
    setSelectedTeams([]);
    setMovementFilter("all");
    syncFiltersToUrl({ search: "", selectedTeams: [], movementFilter: "all" });
  }, [syncFiltersToUrl]);

  const handleMovementFilterChange = useCallback(
    (next) => {
      const id = next || "all";
      setMovementFilter(id);
      syncFiltersToUrl({ movementFilter: id });
    },
    [syncFiltersToUrl],
  );

  const urlFiltersBootstrapped = useRef(false);
  useEffect(() => {
    if (!projMeta || urlFiltersBootstrapped.current) return;
    if (filtersFromUrl.season == null && filtersFromUrl.week == null) {
      syncFiltersToUrl({
        position,
        season: projMeta.default_season,
        week: projMeta.default_week,
      });
    }
    urlFiltersBootstrapped.current = true;
  }, [projMeta, filtersFromUrl.season, filtersFromUrl.week, position, syncFiltersToUrl]);

  useEffect(() => {
    if (!projMeta || seasonModeUserPicked.current) return;
    if (projectionsTab !== "season") return;
    const defaultMode = defaultSeasonMode(projMeta);
    if (seasonMode !== defaultMode) {
      setSeasonMode(defaultMode);
    }
  }, [projMeta, projectionsTab, seasonMode, setSeasonMode]);

  useEffect(() => {
    setSearchQuery("");
  }, [view, projectionsTab, seasonMode, toolsTab]);

  // Restore search from the URL (?q=). Declared after the clear-on-view-change
  // effect so a shared/reloaded URL keeps its search on first mount.
  useEffect(() => {
    if (filtersFromUrl.search != null) setSearchQuery(filtersFromUrl.search);
  }, [filtersFromUrl.search]);

  // Mirror search edits back to the URL (debounced — raw keyboard input).
  useEffect(() => {
    if (!isWeeklyProjections) return undefined;
    if ((filtersFromUrl.search || "") === (searchQuery || "").trim()) return undefined;
    const timer = window.setTimeout(() => syncFiltersToUrl({}), 300);
    return () => window.clearTimeout(timer);
  }, [searchQuery, isWeeklyProjections, filtersFromUrl.search, syncFiltersToUrl]);

  useEffect(() => {
    setMobileMenuOpen(false);
    setMobileFilterOpen(false);
  }, [view, projectionsTab, toolsTab, hubSubView]);

  useEffect(() => {
    if (!mobileMenuOpen) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") setMobileMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mobileMenuOpen]);

  const hubNeedsSignIn = hubAuthRequired !== false && !authenticated;
  const isAdmin = Boolean(user?.is_admin);
  const currentViewLabel = useMemo(() => {
    if (view === "hub") {
      if (hubNeedsSignIn) return "Sign in";
      return "League";
    }
    if (view === "admin") return "Admin";
    return resolveSectionLabel(view, { projectionsTab, toolsTab });
  }, [view, hubNeedsSignIn, projectionsTab, toolsTab]);

  const showDataRefresh = isProjectionsDataView;
  const dataRefreshLoading = isSeasonPreseason
    ? draftLoading
    : isWeeklyProjections
      ? projectionsLoading
      : isSeasonLive
        ? rosLoading
        : loading;

  const goToHub = useCallback(() => {
    setHubMounted(true);
    goToSection("hub");
  }, [goToSection]);

  useEffect(() => {
    if (view === "hub") setHubMounted(true);
  }, [view]);

  useEffect(() => {
    if (headerSubtitle === subtitleDisplay) return undefined;
    setSubtitleFading(true);
    const timer = window.setTimeout(() => {
      setSubtitleDisplay(headerSubtitle);
      setSubtitleFading(false);
    }, 140);
    return () => window.clearTimeout(timer);
  }, [headerSubtitle, subtitleDisplay]);

  useEffect(() => {
    if (draftSeason == null) return undefined;
    const controller = new AbortController();
    fetchDraft(controller.signal);
    return () => controller.abort();
  }, [fetchDraft, draftSeason, position]);

  useEffect(() => {
    if (!isWeeklyProjections || season == null || week == null) return undefined;
    const controller = new AbortController();
    Promise.all([
      fetchProjections(controller.signal),
      fetchSentiment(controller.signal),
    ]);
    return () => controller.abort();
  }, [isWeeklyProjections, fetchProjections, fetchSentiment, season, week, position]);

  useEffect(() => {
    fetchMeta();
  }, [fetchMeta]);

  useEffect(() => {
    if (rosSeason == null || rosFromWeek == null) return undefined;
    const controller = new AbortController();
    fetchRos(controller.signal);
    return () => controller.abort();
  }, [fetchRos, rosSeason, rosFromWeek, position]);

  useEffect(() => {
    if (!isSeasonLive || rosSeason == null || rosFromWeek == null) return undefined;
    const controller = new AbortController();
    fetchSeasonSentiment(controller.signal);
    return () => controller.abort();
  }, [isSeasonLive, fetchSeasonSentiment, rosSeason, rosFromWeek, position]);

  useEffect(() => {
    if (view === "model") {
      fetchAccuracy();
      syncAccuracyRebuildStatus();
    }
  }, [view, fetchAccuracy, syncAccuracyRebuildStatus]);

  const handleSeasonChange = (nextSeason) => {
    const s = Number(nextSeason);
    setSeason(s);
    const weeks = projMeta?.weeks_by_season?.[String(s)] || [];
    let nextWeek = week;
    if (weeks.length) {
      nextWeek = weeks.includes(week) ? week : weeks[weeks.length - 1];
      setWeek(nextWeek);
    }
    syncFiltersToUrl({ season: s, week: nextWeek });
  };

  const handleRosSeasonChange = (nextSeason) => {
    const s = Number(nextSeason);
    setRosSeason(s);
    const weeks = projMeta?.weeks_by_season?.[String(s)] || [];
    let nextFrom = rosFromWeek;
    if (weeks.length) {
      const defaultWeek =
        s === projMeta?.default_season ? projMeta.default_week : weeks[weeks.length - 1];
      nextFrom = weeks.includes(rosFromWeek) ? rosFromWeek : defaultWeek;
      setRosFromWeek(nextFrom);
    }
    syncFiltersToUrl({ rosSeason: s, rosFromWeek: nextFrom });
  };

  const triggerRefresh = async () => {
    setLoading(true);
    try {
      await apiFetch("/api/refresh?retrain=false", { method: "POST" });
      if (isSeasonLive) await fetchRos();
      else if (isSeasonPreseason) await fetchDraft();
      else await fetchProjections();
      await fetchMeta();
    } catch (err) {
      setError(err.message || "Refresh failed");
    } finally {
      setLoading(false);
    }
  };

  const triggerAccuracyRebuild = async () => {
    setAccuracyLoading(true);
    setAccuracyError("");
    try {
      const res = await apiFetch("/api/accuracy/rebuild", { method: "POST" });
      if (!res.ok) throw new Error(await parseApiError(res, "Rebuild failed"));
      setAccuracyRebuildPhase("building");
    } catch (err) {
      setAccuracyRebuildPhase("error");
      setAccuracyError(err.message || "Rebuild failed");
    } finally {
      setAccuracyLoading(false);
    }
  };

  const mobileContextLabel = useMemo(() => {
    if (view === "hub") {
      if (hubNeedsSignIn) return "Sign in";
      const tab = HUB_SUBVIEWS.find((v) => v.id === hubSubView);
      const tabLabel = tab ? (tab.shortLabel || tab.label) : "League";
      if (mobileLayout && hubContext?.league_name) {
        const name = hubContext.league_name;
        const leagueShort = name.length > 18 ? `${name.slice(0, 16)}…` : name;
        return `${leagueShort} · ${tabLabel}`;
      }
      return tab ? `League · ${tabLabel}` : "League";
    }
    if (view === "admin") return "Admin";
    if (view === "model") return "Model accuracy";
    if (view === "projections") {
      const posLabel = POSITIONS.find((p) => p.id === position)?.label || "";
      if (projectionsTab === "weekly") {
        const weekLabel = week != null ? `W${week}` : "Weekly";
        return posLabel ? `${weekLabel} · ${posLabel}` : weekLabel;
      }
      return posLabel ? `Season · ${posLabel}` : "Season";
    }
    if (view === "tools") {
      const tab = TOOLS_TABS.find((t) => t.id === toolsTab);
      return tab ? `Tools · ${tab.label}` : "Tools";
    }
    return currentViewLabel;
  }, [view, hubNeedsSignIn, hubSubView, hubContext, mobileLayout, projectionsTab, position, week, toolsTab, currentViewLabel]);

  const weeklyMobileTabs = useMemo(
    () => [
      { id: "projections", label: "Projections" },
      {
        id: "injuries",
        label: "Injuries",
        badge: sidebarInjuries.length > 0 ? sidebarInjuries.length : null,
      },
      {
        id: "fantasy",
        label:
          sentimentPlayers.length > 0
            ? `Analyst context (${sentimentPlayers.length})`
            : "Analyst context",
        shortLabel: sentimentPlayers.length > 0 ? `Analyst (${sentimentPlayers.length})` : "Analyst",
      },
    ],
    [sidebarInjuries.length, sentimentPlayers.length],
  );

  const seasonMobileTabs = useMemo(
    () => [
      { id: "projections", label: "Projections" },
      {
        id: "narrative",
        label:
          seasonSentimentPlayers.length > 0
            ? `Analyst context (${seasonSentimentPlayers.length})`
            : "Analyst context",
        shortLabel:
          seasonSentimentPlayers.length > 0
            ? `Analyst (${seasonSentimentPlayers.length})`
            : "Analyst",
      },
    ],
    [seasonSentimentPlayers.length],
  );

  const projectionsFilterProps = useMemo(
    () => ({
      projectionsTab,
      seasonMode,
      position,
      onPositionChange: handlePositionChange,
      isWeeklyProjections,
      isSeasonPreseason,
      isSeasonLive,
      projMeta,
      season,
      week,
      weekOptions,
      onSeasonChange: handleSeasonChange,
      onWeekChange: (w) => {
        setWeek(w);
        syncFiltersToUrl({ week: w });
      },
      selectedTeams,
      onTeamsChange: (teams) => {
        setSelectedTeams(teams);
        syncFiltersToUrl({ selectedTeams: teams });
      },
      draftMeta,
      draftSeason,
      onDraftSeasonChange: (v) => {
        setDraftSeason(v);
        syncFiltersToUrl({ draftSeason: v });
      },
      rosSeason,
      rosFromWeek,
      rosWeekOptions,
      onRosSeasonChange: handleRosSeasonChange,
      onRosFromWeekChange: (v) => {
        setRosFromWeek(v);
        syncFiltersToUrl({ rosFromWeek: v });
      },
      seasonModeUserPicked,
      onSeasonModeChange: (mode) => {
        seasonModeUserPicked.current = true;
        setSeasonMode(mode);
      },
      searchQuery,
      onSearchChange: setSearchQuery,
    }),
    [
      projectionsTab,
      seasonMode,
      position,
      handlePositionChange,
      isWeeklyProjections,
      isSeasonPreseason,
      isSeasonLive,
      projMeta,
      season,
      week,
      weekOptions,
      handleSeasonChange,
      selectedTeams,
      syncFiltersToUrl,
      draftMeta,
      draftSeason,
      rosSeason,
      rosFromWeek,
      rosWeekOptions,
      handleRosSeasonChange,
      searchQuery,
    ],
  );

  return (
    <PlayerCardProvider>
    <MobileShell
      section={view}
      onSectionChange={goToSection}
      onMoreOpen={() => setMobileMenuOpen(true)}
    >
        <InviteAccept
          authenticated={authenticated}
          user={user}
          onAccepted={() => {
            goToHub();
            setHubSubView("home");
            window.dispatchEvent(new Event("scoresense-auth-changed"));
          }}
        />
        {authenticated
          && user?.email_verified === false
          && user?.auth_type === "native"
          && view !== "hub" && (
          <VerifyEmailBanner user={user} onVerified={refreshAuth} />
        )}
        {authenticated && (
          <TermsReacceptBanner
            user={user}
            termsUrl={termsUrl}
            privacyUrl={privacyUrl}
            onAccepted={refreshAuth}
          />
        )}
        <InstallPrompt />
        <header className={`app-header${view === "hub" ? " app-header--hub" : ""}${view === "hub" && hubNeedsSignIn ? " app-header--hub-guest" : ""}`}>
          <div className={`app-header-shell${view === "hub" ? " app-header-shell--hub" : ""}`}>
            <MobileHeader
              contextLabel={mobileContextLabel}
              showDataRefresh={showDataRefresh}
              dataRefreshLoading={dataRefreshLoading}
              onRefresh={triggerRefresh}
              onMenuOpen={() => setMobileMenuOpen(true)}
              onFilterOpen={() => setMobileFilterOpen(true)}
              showFilter={view === "projections" && mobileLayout}
              mobileMenuOpen={mobileMenuOpen}
            />

            <div className="app-header-row app-header-row-primary app-header-desktop-only">
              <div className="app-header-brand">
                <h1 className="app-title">{PRODUCT_NAME}</h1>
                <span className="app-header-studio">{STUDIO_NAME}</span>
              </div>
              <nav className="app-header-nav" aria-label="Sections">
                {APP_SECTIONS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`tab view-tab ${view === item.id ? "active" : ""}`}
                    onClick={() => goToSection(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </nav>
              <div className="app-header-actions">
                {showDataRefresh && (
                  <button
                    className="btn-ghost btn-header-action"
                    type="button"
                    onClick={triggerRefresh}
                    disabled={dataRefreshLoading}
                  >
                    {dataRefreshLoading ? "Loading…" : "Refresh"}
                  </button>
                )}
                <UserMenu
                  authReady={authReady}
                  authenticated={authenticated}
                  user={user}
                  isAdmin={isAdmin}
                  view={view}
                  openSignIn={openSignIn}
                  onAccount={() => routerNavigate("/account")}
                  onGoToModel={() => goToSection("model")}
                  onGoToAdmin={() => goToSection("admin")}
                  onLogout={authLogout}
                  refreshStatus={refreshStatus}
                />
              </div>
            </div>

            {view === "projections" && (
              <div className="app-header-projections-toolbar">
                {mobileLayout ? (
                  <MobileSubnav
                    tabs={PROJECTIONS_TABS}
                    active={projectionsTab}
                    onChange={setProjectionsTab}
                    ariaLabel="Projection type"
                  />
                ) : (
                <nav className="app-section-subnav" aria-label="Projection type">
                  {PROJECTIONS_TABS.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      className={`app-section-subnav-btn${projectionsTab === tab.id ? " active" : ""}`}
                      onClick={() => setProjectionsTab(tab.id)}
                    >
                      {tab.label}
                    </button>
                  ))}
                </nav>
                )}

              </div>
            )}

            {view === "tools" && TOOLS_TABS.length > 1 && (
              mobileLayout ? (
                <MobileSubnav
                  tabs={TOOLS_TABS}
                  active={toolsTab}
                  onChange={setToolsTab}
                  ariaLabel="Tools"
                />
              ) : (
              <nav className="app-section-subnav" aria-label="Tools">
                {TOOLS_TABS.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    className={`app-section-subnav-btn${toolsTab === tab.id ? " active" : ""}`}
                    onClick={() => setToolsTab(tab.id)}
                  >
                    {tab.label}
                  </button>
                ))}
              </nav>
              )
            )}

            {view === "hub" && !hubNeedsSignIn && !mobileLayout && (
              <HubSubnav
                subView={hubSubView}
                hubContext={hubContext}
                onNavigate={setHubSubView}
                mobileLayout={mobileLayout}
              />
            )}
          </div>

          {!(view === "projections" && projectionsTab === "weekly") && view !== "hub" && (
            <div className="subtitle-slot">
              <p className={`subtitle ${subtitleFading ? "subtitle-fading" : ""}`}>{subtitleDisplay}</p>
              {view === "projections" && (
                <p className="chart-note app-product-disclaimer">{PRODUCT_DISCLAIMER}</p>
              )}
            </div>
          )}
        </header>

        {view === "projections" && !mobileLayout && (
          <ProjectionsFilterBar {...projectionsFilterProps} />
        )}

        <MobileMenuSheet
          open={mobileMenuOpen}
          onClose={() => setMobileMenuOpen(false)}
          authReady={authReady}
          authenticated={authenticated}
          user={user}
          openSignIn={openSignIn}
          authLogout={authLogout}
          showDataRefresh={showDataRefresh}
          dataRefreshLoading={dataRefreshLoading}
          onRefresh={triggerRefresh}
          refreshStatus={refreshStatus}
          view={view}
          isAdmin={isAdmin}
          onGoToModel={() => goToSection("model")}
          onGoToAdmin={() => goToSection("admin")}
          onGoToAccount={() => routerNavigate("/account")}
          termsUrl={termsUrl}
          privacyUrl={privacyUrl}
        />

        <MobileFilterSheet
          open={mobileFilterOpen}
          onClose={() => setMobileFilterOpen(false)}
          view={view}
          filterProps={projectionsFilterProps}
        />

        {error && isProjectionsDataView && (
          <div className="error">{error}</div>
        )}

        {view === "projections" && mobileLayout && (
          <div className="projections-mobile-pos-row">
            <div className="projections-mobile-pos-chips" role="group" aria-label="Position">
              {POSITIONS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`tab header-segment-tab ${position === p.id ? "active" : ""}`}
                  onClick={() => handlePositionChange(p.id)}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <span
              className="projections-mobile-scoring-chip"
              title="ScoreSense weekly model is trained on PPR scoring"
            >
              PPR
            </span>
          </div>
        )}

        {hubMounted && (
          <div
            className={view === "hub" ? "app-view-pane" : "app-view-pane app-view-pane-hidden"}
            aria-hidden={view !== "hub"}
          >
            <DraftHub
              subView={hubSubView}
              onSubViewChange={setHubSubView}
              onHubContextChange={setHubContext}
              insightTab={insightTab}
              onInsightTabChange={nav.setInsightTab}
              officeTab={nav.officeTab}
              onOfficeTabChange={nav.setOfficeTab}
            />
          </div>
        )}

        {view === "projections" && projectionsTab === "weekly" && (
          <>
            {compareViewOpen && compareIds.length >= 2 ? (
              <PlayerCompare
                playerIds={compareIds}
                season={season}
                week={week}
                applyInjuryAdjustments={isLiveContext}
                onClose={handleCloseCompare}
                onClear={handleClearCompare}
                onRemovePlayer={handleRemoveComparePlayer}
              />
            ) : (
              <>
            {mobileLayout && (
              <MobileSubnav
                tabs={weeklyMobileTabs}
                active={projectionsMobilePanel}
                onChange={setProjectionsMobilePanel}
                ariaLabel="Weekly view"
                className="projections-mobile-tabs"
                showShortLabels
              />
            )}
            <div className="grid projections-grid">
            <section className={`panel wide panel-projections projections-mobile-panel${projectionsMobilePanel === "projections" ? " is-mobile-active" : ""}`}>
              <div className="panel-head panel-head-mobile-compact">
                <div>
                  <h2>Weekly projections</h2>
                  {season != null && week != null ? (
                    <p className="panel-subtitle">
                      {season} · Wk {week}
                      {meta?.built_at && formatRelativeTime(meta.built_at)
                        ? ` · Projections ${String(formatRelativeTime(meta.built_at)).replace(/^Updated /i, "").toLowerCase()}`
                        : ""}
                    </p>
                  ) : null}
                </div>
              </div>
              {!isLiveContext && projMeta && !meta?.preseason_mode && (
                <div className="info-callout info-callout-compact" role="status">
                  Showing base projections for this week (live injury boosts apply to Wk {projMeta.default_week} only).
                </div>
              )}
              <WeeklyTable
                rows={tableRows}
                search={searchQuery}
                teamsFilter={selectedTeams}
                loading={projectionsLoading}
                showSentiment
                position={position}
                season={season}
                week={week}
                applyInjuryAdjustments={isLiveContext}
                onClearFilters={clearTableFilters}
                movementFilter={movementFilter}
                onMovementFilterChange={handleMovementFilterChange}
                movementAvailable={Boolean(meta?.projection_movement?.available)}
                compareEnabled
                selectedCompareIds={compareIds}
                maxCompare={MAX_COMPARE_PLAYERS}
                onToggleCompare={handleToggleCompare}
                onOpenCompare={handleOpenCompare}
                onClearCompare={handleClearCompare}
                onRemoveCompare={handleRemoveComparePlayer}
                compareSelectionMeta={compareSelectionMeta}
                searchSlot={
                  !mobileLayout ? null : (
                  <input
                    type="search"
                    className="search-input"
                    placeholder="Player or team…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    aria-label="Search player or team"
                  />
                  )
                }
              />
            </section>

            <InjurySidebar
              className={`projections-mobile-panel${projectionsMobilePanel === "injuries" ? " is-mobile-active" : ""}`}
              players={sidebarInjuries}
              position={position}
              selectedTeams={selectedTeams}
              searchQuery={searchQuery}
              isLiveContext={isLiveContext}
              defaultSeason={projMeta?.default_season}
              defaultWeek={projMeta?.default_week}
            />

            <SentimentPanel
              className={`projections-mobile-panel${projectionsMobilePanel === "fantasy" ? " is-mobile-active" : ""}`}
              position={position}
              season={season}
              week={week}
              scope="weekly"
              players={sentimentPlayers}
              meta={sentimentMeta}
              loading={sentimentLoading}
              error={sentimentError}
            />
          </div>
              </>
            )}
          </>
        )}

        {view === "projections" && projectionsTab === "season" && (
          <section className="panel wide panel-season">
            {/* Desktop already exposes this switch in the filter bar. */}
            {mobileLayout && (
              <nav className="season-mode-tabs" role="tablist" aria-label="Season mode">
                {SEASON_MODES.map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    role="tab"
                    aria-selected={seasonMode === mode.id}
                    title={mode.hint}
                    className={`season-mode-tab${seasonMode === mode.id ? " active" : ""}`}
                    onClick={() => {
                      seasonModeUserPicked.current = true;
                      setSeasonMode(mode.id);
                    }}
                  >
                    <span className="season-mode-tab-label">{mode.shortLabel}</span>
                  </button>
                ))}
              </nav>
            )}

            {seasonMode === "preseason" ? (
              <DraftTable
                  rows={draftProjections}
                  search={searchQuery}
                  loading={draftLoading}
                  position={position}
                  season={draftSeason}
                  onClearFilters={clearTableFilters}
                  searchSlot={
                    <input
                      type="search"
                      className="search-input"
                      placeholder="Player or team…"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      aria-label="Search player or team"
                    />
                  }
                  metaLine={
                    draftSeason != null ? (
                      <span className="table-meta">
                        {draftSeason} preseason
                        {draftResponseMeta?.season_quantile_method === "mc_schedule_v1"
                          ? " · schedule-aware P10–P90"
                          : draftResponseMeta?.games_per_season
                            ? ` · ${draftResponseMeta.games_per_season}-game pace (preliminary)`
                            : " · preliminary season bands"}
                        {draftResponseMeta?.feature_season != null
                          && draftResponseMeta.feature_season < draftSeason
                          ? ` · ${draftResponseMeta.feature_season} inputs`
                          : ""}
                      </span>
                    ) : null
                  }
                  seasonQuantileMethod={draftResponseMeta?.season_quantile_method}
                />
            ) : seasonLoading ? (
              <div className="season-refresh-banner" role="status" aria-live="polite">
                <span className="season-transition-spinner season-transition-spinner-sm" aria-hidden="true" />
                Loading {rosSeason ?? projMeta?.default_season} season data…
              </div>
            ) : seasonTransition ? (
              <SeasonTransitionState
                season={rosMeta?.season ?? rosSeason ?? projMeta?.default_season}
                refreshing={false}
              />
            ) : (
              <>
                {mobileLayout && (
                  <MobileSubnav
                    tabs={seasonMobileTabs}
                    active={seasonMobilePanel || "projections"}
                    onChange={setSeasonMobilePanel}
                    ariaLabel="Season view"
                    className="projections-mobile-tabs"
                    showShortLabels
                  />
                )}
                <div className="grid projections-grid projections-grid--season-live">
                  <div
                    className={`projections-mobile-panel${!seasonMobilePanel || seasonMobilePanel === "projections" ? " is-mobile-active" : ""}`}
                  >
                    {seasonRefreshing && (
                      <div className="season-refresh-banner" role="status" aria-live="polite">
                        <span className="season-transition-spinner season-transition-spinner-sm" aria-hidden="true" />
                        Updating {rosMeta?.season ?? projMeta?.default_season} season totals…
                      </div>
                    )}
                    <SeasonTable
                      rows={rosTableRows}
                      seasonComplete={seasonComplete}
                      projectionWeek={rosMeta?.projection_week}
                      search={searchQuery}
                      showSentiment
                      position={position}
                      season={rosSeason ?? season}
                      week={rosFromWeek ?? week}
                      onClearFilters={clearTableFilters}
                      searchSlot={
                        <input
                          type="search"
                          className="search-input"
                          placeholder="Player or team…"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          aria-label="Search player or team"
                        />
                      }
                      metaLine={
                        rosMeta?.season != null ? (
                          <span className="table-meta">
                            {rosMeta.season} season
                            {seasonComplete ? " · final" : ` · ${rosMeta.weeks_remaining} weeks left`}
                            {rosFromWeek != null ? ` · as of week ${rosFromWeek}` : ""}
                          </span>
                        ) : null
                      }
                      loading={seasonLoading}
                    />
                  </div>

                  <SentimentPanel
                    className={seasonMobilePanel === "narrative" ? "is-mobile-active" : ""}
                    position={position}
                    season={rosSeason ?? season}
                    week={rosFromWeek ?? week}
                    scope="season"
                    players={seasonSentimentPlayers}
                    meta={seasonSentimentMeta}
                    loading={seasonSentimentLoading}
                    error={seasonSentimentError}
                  />
                </div>
              </>
            )}
          </section>
        )}

        {view === "tools" && (
          <DfsOptimizer projMeta={projMeta} loading={loading} />
        )}

        {view === "model" && accuracyRebuildPhase === "building" && (
          <div className="accuracy-notice" role="status" aria-live="polite">
            <span className="season-transition-spinner season-transition-spinner-sm" aria-hidden="true" />
            Rebuilding baseline and upside reports for QB, RB, and WR — checking every 12s…
          </div>
        )}

        {view === "model" && accuracyRebuildPhase === "ready" && (
          <div className="accuracy-notice accuracy-notice-success" role="status" aria-live="polite">
            Rebuild complete.{" "}
            <button type="button" className="accuracy-notice-action" onClick={loadFreshAccuracy}>
              Load new data
            </button>
          </div>
        )}

        {view === "model" && (
          <Suspense fallback={<div className="sentiment-charts-empty">Loading accuracy charts…</div>}>
            <AccuracyChart
              report={accuracyReport}
              upsideReport={upsideReport}
              seasonLongReport={seasonLongReport}
              loading={accuracyLoading}
              onRebuild={triggerAccuracyRebuild}
              rebuildLoading={accuracyLoading}
              error={
                accuracyError ||
                (accuracyReport && !accuracyReport.seasons?.length
                  ? "Accuracy report is empty or malformed."
                  : "")
              }
            />
          </Suspense>
        )}

        {view === "admin" && isAdmin && (
          <AdminPortal adminTab={adminTab || "overview"} onAdminTabChange={setAdminTab} />
        )}
        {!mobileLayout && (
          <LegalLinks termsUrl={termsUrl} privacyUrl={privacyUrl} className="app-legal-footer" compact />
        )}
      </MobileShell>
    </PlayerCardProvider>
  );
}
