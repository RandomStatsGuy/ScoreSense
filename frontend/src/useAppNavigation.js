import { useCallback, useMemo } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  buildAppPath,
  buildFilterSearchParams,
  parseAppPath,
  parseFilterParams,
} from "./routes";

export default function useAppNavigation() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  const route = useMemo(
    () => parseAppPath(location.pathname) || {
      view: "projections",
      projectionsTab: "weekly",
      projectionsMobilePanel: "projections",
      seasonMode: "live",
      toolsTab: "dfs",
      hubSubView: "home",
      insightTab: "overview",
      officeTab: "current",
      adminTab: "overview",
    },
    [location.pathname],
  );

  const filtersFromUrl = useMemo(
    () => parseFilterParams(searchParams),
    [searchParams],
  );

  const navigateTo = useCallback(
    (next, { replace = false, filterUpdates = null } = {}) => {
      const path = buildAppPath({ ...route, ...next });
      let search = location.search;
      if (filterUpdates) {
        const params = buildFilterSearchParams({
          ...filterUpdates,
          preserveParams: searchParams,
        });
        const qs = params.toString();
        search = qs ? `?${qs}` : "";
      }
      navigate({ pathname: path, search }, { replace });
    },
    [navigate, route, location.search, searchParams],
  );

  const goToSection = useCallback(
    (section) => {
      if (section === route.view && section !== "hub") return;
      const base = { view: section };
      if (section === "hub") base.hubSubView = route.hubSubView || "home";
      if (section === "projections") {
        base.projectionsTab = route.projectionsTab || "weekly";
        base.seasonMode = route.seasonMode || "live";
      }
      if (section === "tools") base.toolsTab = route.toolsTab || "dfs";
      navigateTo(base);
    },
    [navigateTo, route],
  );

  const setProjectionsTab = useCallback(
    (tab) => navigateTo({ view: "projections", projectionsTab: tab }),
    [navigateTo],
  );

  const setProjectionsMobilePanel = useCallback(
    (panel) => navigateTo({
      view: "projections",
      projectionsTab: "weekly",
      projectionsMobilePanel: panel,
    }),
    [navigateTo],
  );

  const setSeasonMobilePanel = useCallback(
    (panel) => navigateTo({
      view: "projections",
      projectionsTab: "season",
      seasonMode: route.seasonMode || "live",
      seasonMobilePanel: panel,
    }),
    [navigateTo, route.seasonMode],
  );

  const setSeasonMode = useCallback(
    (mode) => navigateTo({
      view: "projections",
      projectionsTab: "season",
      seasonMode: mode,
    }),
    [navigateTo],
  );

  const setToolsTab = useCallback(
    (tab) => navigateTo({ view: "tools", toolsTab: tab }),
    [navigateTo],
  );

  const setHubSubView = useCallback(
    (subView, insightOrOfficeTab) => {
      navigateTo({
        view: "hub",
        hubSubView: subView,
        insightTab: subView === "insights" ? (insightOrOfficeTab || route.insightTab || "overview") : null,
        officeTab: subView === "office" ? (insightOrOfficeTab || route.officeTab || "current") : null,
      });
    },
    [navigateTo, route.insightTab, route.officeTab],
  );

  const setInsightTab = useCallback(
    (tab) => navigateTo(
      {
        view: "hub",
        hubSubView: "insights",
        insightTab: tab,
        officeTab: null,
      },
      { filterUpdates: tab === "ownership" ? null : { player: "" } },
    ),
    [navigateTo],
  );

  const openPlayerContractHistory = useCallback(
    (player) => {
      const playerId = typeof player === "string"
        ? player
        : (player?.playerId || player?.player_id || "");
      if (!playerId) return;
      navigateTo(
        {
          view: "hub",
          hubSubView: "insights",
          insightTab: "ownership",
          officeTab: null,
        },
        { filterUpdates: { player: String(playerId) } },
      );
    },
    [navigateTo],
  );

  const setOfficeTab = useCallback(
    (tab) => navigateTo({
      view: "hub",
      hubSubView: "office",
      officeTab: tab,
      insightTab: null,
    }),
    [navigateTo],
  );

  const setAdminTab = useCallback(
    (tab) => navigateTo({ view: "admin", adminTab: tab }),
    [navigateTo],
  );

  const updateFilters = useCallback(
    (updates) => {
      const params = buildFilterSearchParams({
        ...updates,
        preserveParams: searchParams,
      });
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  return {
    ...route,
    filtersFromUrl,
    searchParams,
    goToSection,
    setProjectionsTab,
    setProjectionsMobilePanel,
    setSeasonMode,
    setSeasonMobilePanel,
    setToolsTab,
    setHubSubView,
    setInsightTab,
    openPlayerContractHistory,
    setOfficeTab,
    setAdminTab,
    navigateTo,
    updateFilters,
  };
}
