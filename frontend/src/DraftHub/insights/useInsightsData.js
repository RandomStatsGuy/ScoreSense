import { useCallback, useEffect, useRef } from "react";
import { apiFetch } from "../../auth";
import { connectionErrorMessage, parseApiError } from "../../format";
import {
  clearInsightsSectionCache,
  getInsightsSection,
  setInsightsSection,
} from "../hubDataCache";

export const INSIGHTS_TAB_SECTIONS = {
  cap: "cap",
  scoring: "scoring",
  ownership: null,
  desk: null,
};

export const DEFAULT_POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"];

/** API may send positions: [] on scoring-only payloads — never treat that as intentional. */
export function resolveAnalyticsPositions(analytics) {
  const positions = analytics?.positions;
  return Array.isArray(positions) && positions.length > 0 ? positions : DEFAULT_POSITIONS;
}

function mergeAnalyticsBlock(prev, next, capInRequest) {
  const pick = capInRequest
    ? ((next?.teams || []).length ? next : (next ?? prev))
    : ((next?.teams?.length ? next : prev));
  if (!pick) return pick;
  return { ...pick, positions: resolveAnalyticsPositions(pick) };
}

export function insightsLoadCacheKey(tab, opts, refs) {
  if (tab === "scoring") {
    const s = opts.scoringSeason ?? refs.scoringSeasonRef.current ?? "current";
    return `scoring:${s}`;
  }
  if (tab === "cap") {
    const h = opts.capSeason ?? refs.capSeasonRef.current ?? "current";
    return `cap:${h}`;
  }
  return tab;
}

export function mergeInsightsPayload(prev, next, opts = {}) {
  if (!prev) return next;
  if (!next) return prev;
  const sections = String(opts.sections || "");
  const capInRequest = !sections || sections.includes("cap");
  return {
    ...prev,
    ...next,
    hub_context: next.hub_context ?? prev.hub_context,
    cache_status: next.cache_status ?? prev.cache_status,
    analytics: mergeAnalyticsBlock(prev.analytics, next.analytics, capInRequest),
    historic: next.historic?.available || (next.historic?.awards || []).length
      ? next.historic
      : prev.historic,
    trade: (next.trade?.suggestions || []).length || (next.trade?.partners || []).length
      ? next.trade
      : (next.trade?.empty_reason != null ? next.trade : prev.trade),
    scoring: next.scoring?.available ? next.scoring : (next.scoring?.season ? next.scoring : prev.scoring),
    efficiency: (next.efficiency?.teams || []).length
      ? next.efficiency
      : ((prev.efficiency?.teams || []).length ? prev.efficiency : next.efficiency),
    ownership: (next.ownership?.players || []).length ? next.ownership : prev.ownership,
    draft_recap: next.draft_recap ?? prev.draft_recap,
  };
}

export function useInsightsData(leagueId, refs) {
  const loadGenerationRef = useRef(0);
  const loadCacheRef = useRef(new Map());
  const scoringPrefetchRef = useRef(false);
  const leagueIdRef = useRef(leagueId);
  leagueIdRef.current = leagueId;

  // Prefetch is one-shot per league; reset when the room changes so the next
  // league can warm Scoring. Bump generation so in-flight loads/prefetches from
  // the previous room cannot merge into or discard the new league's responses.
  useEffect(() => {
    scoringPrefetchRef.current = false;
    loadGenerationRef.current += 1;
  }, [leagueId]);

  const resolveHistorySeason = useCallback((tab, opts = {}) => {
    const active = opts.activeTab ?? tab;
    if (active === "cap") return opts.capSeason ?? refs.capSeasonRef.current;
    if (active === "scoring") {
      return opts.scoringSeason ?? refs.scoringSeasonRef.current ?? "current";
    }
    if (active === "ownership" || active === "desk") {
      return opts.historySeason ?? refs.historySeasonRef.current;
    }
    return "current";
  }, [refs]);

  const load = useCallback(async (opts = {}, handlers = {}) => {
    if (!leagueId) return;
    const {
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
    } = handlers;
    const tab = opts.activeTab ?? activeTabRef?.current ?? "cap";
    const sections = opts.sections ?? INSIGHTS_TAB_SECTIONS[tab];
    const cacheKey = sections ? insightsLoadCacheKey(tab, opts, refs) : null;
    const seasonKey = cacheKey?.split(":").slice(1).join(":") || "current";

    if (!opts.refresh && cacheKey && loadCacheRef.current.has(cacheKey)) {
      const cached = loadCacheRef.current.get(cacheKey);
      setData?.((prev) => mergeInsightsPayload(prev || {}, cached, { sections }));
      if (!sections || sections.includes("cap")) {
        setVisiblePositions?.(new Set(resolveAnalyticsPositions(cached.analytics)));
      }
      setLoading?.(false);
      setTabLoading?.(false);
      return;
    }

    const sessionCached = sections && !opts.refresh && !opts.skipSessionCache
      ? getInsightsSection(leagueId, tab, seasonKey)
      : null;
    const hasStale = Boolean(sessionCached);
    if (hasStale) {
      setData?.((prev) => mergeInsightsPayload(prev || {}, sessionCached, { sections }));
      if (!sections || sections.includes("cap")) {
        setVisiblePositions?.(new Set(resolveAnalyticsPositions(sessionCached.analytics)));
      }
      if (!opts.background) setLoading?.(false);
    }

    const generation = ++loadGenerationRef.current;
    const background = Boolean(
      opts.background || (opts.merge && dataRef?.current) || hasStale,
    );
    // One in-flight load owns one indicator; clear the other so a discarded
    // background prefetch cannot leave tabLoading stuck after a foreground load.
    if (background) {
      setTabLoading?.(true);
      setLoading?.(false);
    } else {
      setLoading?.(true);
      setTabLoading?.(false);
    }
    setError?.("");

    try {
      const params = new URLSearchParams();
      if (opts.refresh) params.set("refresh", "1");
      const hist = resolveHistorySeason(tab, opts);
      if (hist && hist !== "current") params.set("history_season", String(hist));
      const season = opts.scoringSeason
        ?? refs.scoringSeasonRef.current
        ?? latestScoringSeasonRef?.current
        ?? "current";
      if (tab === "scoring" && season && season !== "current") {
        params.set("scoring_season", String(season));
        if (season !== "all" && /^\d+$/.test(String(season))) {
          params.set("cap_efficiency_season", String(season));
        }
      }
      const capOnly = sections === "cap";
      const scoringOnly = sections === "scoring";
      if (sections && !capOnly && !scoringOnly) params.set("sections", sections);
      const q = params.toString() ? `?${params.toString()}` : "";
      const root = hubContextRef?.current?.demo ? "/api/hub/demo" : "/api/hub";
      const insightsRoute = capOnly ? "insights/cap" : scoringOnly ? "insights/scoring" : "insights";
      const res = await apiFetch(`${root}/league/${encodeURIComponent(leagueId)}/${insightsRoute}${q}`);
      if (!res.ok) throw new Error(await parseApiError(res));
      const payload = await res.json();
      if (generation !== loadGenerationRef.current) return;
      if (cacheKey) loadCacheRef.current.set(cacheKey, payload);
      if (sections) setInsightsSection(leagueId, tab, seasonKey, payload);
      setData?.((prev) => (opts.merge
        ? mergeInsightsPayload(prev, payload, { sections })
        : payload));
      if (!sections || sections.includes("cap")) {
        setVisiblePositions?.(new Set(resolveAnalyticsPositions(payload.analytics)));
      }
      const seasonLabel = payload.scoring?.requested_season || payload.scoring?.season;
      if (seasonLabel && seasonLabel !== "all" && latestScoringSeasonRef) {
        latestScoringSeasonRef.current = String(seasonLabel);
      }
      if (seasonLabel && !opts.keepSeason && tab !== "cap") {
        setScoringSeason?.(String(seasonLabel));
      }
      if (!opts.keepChartHidden) {
        setChartHiddenTeams?.(new Set());
      }
      const teams = payload.analytics?.teams;
      if (teams?.length && setTeamPick && resolveDefaultTeamPick && hubContextRef) {
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
      setError?.(/internal server error|500/i.test(msg)
        ? "Insights failed to load. Try again in a moment or switch tabs."
        : msg);
    } finally {
      if (generation !== loadGenerationRef.current) return;
      if (background) setTabLoading?.(false);
      else setLoading?.(false);
    }
  }, [leagueId, refs, resolveHistorySeason]);

  const resetCache = useCallback(() => {
    loadCacheRef.current.clear();
    scoringPrefetchRef.current = false;
    if (leagueId) clearInsightsSectionCache(leagueId);
  }, [leagueId]);

  const prefetchScoring = useCallback(async (handlers) => {
    if (!leagueId || scoringPrefetchRef.current) return;
    scoringPrefetchRef.current = true;
    const prefetchFor = leagueId;
    try {
      const root = handlers.hubContextRef?.current?.demo ? "/api/hub/demo" : "/api/hub";
      const res = await apiFetch(
        `${root}/league/${encodeURIComponent(prefetchFor)}/insights/status`,
      );
      if (res.ok) {
        const status = await res.json();
        if (status.scoring !== "hit") return;
      }
    } catch {
      return;
    }
    // Drop if the user switched leagues while the status check was in flight.
    if (leagueIdRef.current !== prefetchFor) return;
    await load(
      {
        sections: "scoring",
        merge: true,
        keepSeason: true,
        keepChartHidden: true,
        background: true,
        activeTab: "scoring",
        skipSessionCache: true,
      },
      handlers,
    );
  }, [leagueId, load]);

  return {
    load,
    resetCache,
    prefetchScoring,
    scoringPrefetchRef,
    loadCacheRef,
  };
}
