import useDataRevision from "./useDataRevision";
import { useEffect, useRef, useState } from "react";
import { apiFetch, getToken } from "./auth";
import { localDraftScope } from "./dfsLocalDraft.js";
import { dfsNavigationDraft } from "./dfsNavigationDraft.js";
import { readJsonResponse } from "./apiJson.js";
import {
  DEFAULT_FORMATS,
  parseLineupCount,
  DFS_WORKSPACE_COPY as C,
  DFS_STEP_COPY,
  defaultSlateCategory,
  gameTeamCodes,
  isCaptainFormat,
  normalizeLineupDifferences,
  slateGames,
} from "./dfsToolPresentation";
import { parseDfsCsv, headerKey } from "./dfsCsv";
import { captainComparisonRequest } from "./dfsCaptainComparisonRequest.js";
import { DFS_CAPTAIN_COMPARISON_COPY as CC, DFS_PORTFOLIO_COPY as PC } from "./dfsToolPresentation";
import { appendPortfolioBatch, createPortfolioBatch, freezeSnapshot, removePortfolioBatch, portfolioBuildPayload } from "./dfsPortfolio.js";
import { exposureRequest, convertExposureUnits, groupExposureRequest, exposureRuleFromRequest } from "./dfsGlobalExposure.js";
import { assertBuildPlanApplied } from "./dfsBuildPlans.js";
import { normalizeClassicStackRules, DEFAULT_CLASSIC_STACK_RULES } from "./dfsClassicStackRules.js";
import { DFS_GLOBAL_COPY as GC } from "./dfsToolPresentation.js";
import { stableBuildKey } from "./dfsEntryExportSeal.js";
import { poolVersion, previewPoolUpdate } from "./dfsWorkspaceState.js";
import { DFS_WORKFLOW_COPY as WC } from "./dfsToolPresentation.js";
import { applyPortfolioReplacement } from "./dfsPortfolioReview.js";
import { newShowdownRules, showdownScoreMetadata } from "./dfsShowdownReview.js";
import { DFS_SHOWDOWN_COPY as SC } from "./dfsToolPresentation.js";

async function jsonRequest(url, options) {
  const response = await apiFetch(url, options);
  return readJsonResponse(response, url);
}
export { jsonRequest };

export default function useDfsBuilder(projMeta) {
  const [initial, setInitial] = useState(() => dfsNavigationDraft.read(localDraftScope(getToken())));
  const draftScope = useRef(localDraftScope(getToken()));
  const accountEpoch = useRef(0);
  const [accountRevision, setAccountRevision] = useState(0);
  const latestDraft = useRef(null);
  const [workspaceUi, setWorkspaceUi] = useState(initial?.workspaceUi || { stage: 0, view: "build" });
  const dataRevision = useDataRevision();
  const seenRevision = useRef(initial?.seenRevision ?? dataRevision);
  const [dataUpdateAvailable, setDataUpdateAvailable] = useState(initial?.dataUpdateAvailable || false);
  const [poolReload, setPoolReload] = useState(0);
  const [poolUpdate, updatePoolUpdate] = useState(initial?.poolUpdate || null);
  const pendingPoolUpdate = useRef(poolUpdate);
  const setPoolUpdate = next => { pendingPoolUpdate.current = next; updatePoolUpdate(next); };
  const [poolUpdateHistory, setPoolUpdateHistory] = useState(initial?.poolUpdateHistory || null);
  const [poolInputVersion, setPoolInputVersion] = useState(initial?.poolInputVersion || 1);
  const poolInputVersionRef = useRef(initial?.poolInputVersion || 1);
  const poolUndo = useRef(null);
  useEffect(() => {
    if (dataRevision !== seenRevision.current) {
      seenRevision.current = dataRevision;
      setDataUpdateAvailable(true);
    }
  }, [dataRevision]);
  const [meta, setMeta] = useState(projMeta || initial?.meta);
  const [formats, setFormats] = useState(initial?.formats || DEFAULT_FORMATS);
  const [context, setContext] = useState(initial?.context || {
    site: "draftkings",
    season: null,
    week: null,
    slateId: "",
    source: "live",
  });
  const [slates, setSlates] = useState(initial?.slates || []);
  const [pool, setPool] = useState(initial?.pool || []);
  const [salaries, setSalaries] = useState(initial?.salaries || []);
  const [salarySnapshot, setSalarySnapshot] = useState(initial?.salarySnapshot || null);
  const [stats, setStats] = useState(initial?.stats || null);
  const [poolFreshness, setPoolFreshness] = useState(initial?.poolFreshness || { checkedAt: null, refresh: null, failed: false });
  const [vegasGames, setVegasGames] = useState(initial?.vegasGames || []);
  const [stackWeights, setStackWeights] = useState(initial?.stackWeights || {});
  const [slateName, setSlateName] = useState(initial?.slateName || "");
  const [busy, setBusy] = useState(false);
  const [building, setBuilding] = useState(false);
  const [buildJob, setBuildJob] = useState(initial?.buildJob || null);
  const buildAbort = useRef(null);
  const buildGeneration = useRef(0);
  const [comparing, setComparing] = useState(false);
  const [comparison, setComparison] = useState(initial?.comparison || null);
  const [comparisonError, setComparisonError] = useState("");
  const [playerComparison, setPlayerComparison] = useState(initial?.playerComparison || null);
  const [comparisonStartedAt, setComparisonStartedAt] = useState(initial?.comparisonStartedAt || null);
  const comparisonGeneration = useRef(0);
  const comparisonAbort = useRef(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(initial ? WC.draftResumed : "");
  const [lineups, setLineups] = useState(initial?.lineups || []);
  const [selected, setSelected] = useState(initial?.selected || 0);
  const [savedBuild, setSavedBuild] = useState(initial?.savedBuild || null);
  const [buildSettings, setBuildSettings] = useState(initial?.buildSettings || null);
  const [currentBuild, setCurrentBuild] = useState(() => initial?.currentBuild ? freezeSnapshot(initial.currentBuild) : null);
  const [portfolio, setPortfolio] = useState(() => initial?.portfolio ? freezeSnapshot(initial.portfolio) : []);
  const [portfolioLimits, setPortfolioLimits] = useState(initial?.portfolioLimits || {});
  const [portfolioRules, setPortfolioRules] = useState(initial?.portfolioRules || { version: 1, players: {}, groups: [] });
  const [portfolioUndo, setPortfolioUndo] = useState(null);
  const [globalExposure, setGlobalExposure] = useState(initial?.globalExposure || {});
  const [globalUnit, setGlobalUnit] = useState(initial?.globalUnit || "percent");
  const [globalGroups, setGlobalGroups] = useState(initial?.globalGroups || []);
  const [classicStackRules, setClassicStackRules] = useState(initial?.classicStackRules || DEFAULT_CLASSIC_STACK_RULES);
  const [stackScope, setStackScope] = useState(initial?.stackScope || { teams: [], qbIds: [] });
  const [appliedPlan, setAppliedPlan] = useState(initial?.appliedPlan || null);
  const [portfolioSelection, setPortfolioSelection] = useState(initial?.portfolioSelection || null);
  const portfolioBuildIds = useRef(new Map());
  const [portfolioRestoreRevision, setPortfolioRestoreRevision] = useState(0);
  const [locked, setLocked] = useState(initial?.locked || []);
  const [excluded, setExcluded] = useState(initial?.excluded || []);
  const [overrides, setOverrides] = useState(initial?.overrides || {});
  const [ownership, setOwnership] = useState(initial?.ownership || {});
  const [projectionImportSource, setProjectionImportSource] = useState(initial?.projectionImportSource || null);
  const [captainLimits, setCaptainLimits] = useState(initial?.captainLimits || {});
  const defaultSettings = {
    count: 20,
    objective: "median",
    exposure: 1,
    differences: 2,
    qbStack: 0,
    requireQbStack: false,
    bringBack: false,
    maxTeam: 0,
    minSalary: 0,
    maxSalary: 50000,
    randomness: 0,
    lockedCaptain: "",
    note: "",
    portfolioMode: "legacy",
    blockQbDst: true,
    showdownRules: newShowdownRules(),
  };
  const [settings, setSettings] = useState(initial?.settings || defaultSettings);
  const activeWork = useRef(false);
  activeWork.current = building || comparing;
  const generation = useRef(0);
  const projectionImportSerial = useRef(0);
  const revision = useRef(0);
  const workingPool = useRef(pool);
  workingPool.current = pool;
  const workingSalarySnapshot = useRef(salarySnapshot);
  workingSalarySnapshot.current = salarySnapshot;
  const restoredContext = useRef(Boolean(initial));
  const keepRestoredComparison = useRef(Boolean(initial));
  latestDraft.current = { scope: draftScope.current, epoch: accountEpoch.current, state: {
    meta, formats, context, slates, pool, salaries, salarySnapshot, stats, poolFreshness, vegasGames,
    stackWeights, slateName, lineups, selected, savedBuild, buildSettings, currentBuild, portfolio,
    portfolioLimits, portfolioRules, globalExposure, globalUnit, globalGroups, classicStackRules,
    stackScope, appliedPlan, portfolioSelection, locked, excluded, overrides, ownership, captainLimits,
    settings, poolInputVersion, poolUpdate, poolUpdateHistory, dataUpdateAvailable, workspaceUi,
    comparison, playerComparison, comparisonStartedAt, buildJob, projectionImportSource,
    seenRevision: seenRevision.current,
  } };
  useEffect(() => () => {
    const latest = latestDraft.current;
    if (latest?.epoch === accountEpoch.current && latest.scope === localDraftScope(getToken())) {
      dfsNavigationDraft.write(latest.scope, latest.state);
    }
    generation.current++;
    projectionImportSerial.current++;
    comparisonGeneration.current++;
    comparisonAbort.current?.abort();
  }, []);
  const cancelBuild = () => {
    buildGeneration.current++;
    buildAbort.current?.abort();
    buildAbort.current = null;
    setBuilding(false);
    setBuildJob(job => job?.status === "running" ? { ...job, status: "cancelled", finishedAt: Date.now() } : job);
  };
  useEffect(() => () => { buildGeneration.current++; buildAbort.current?.abort(); }, []);
  const config = formats[context.site] || DEFAULT_FORMATS[context.site];
  useEffect(() => {
    const reset = () => {
      const currentMeta = latestDraft.current?.state.meta;
      accountEpoch.current++;
      draftScope.current = localDraftScope(getToken());
      dfsNavigationDraft.clear();
      setInitial(null);
      restoredContext.current = false;
      setAccountRevision(value => value + 1);
      cancelBuild();
      comparisonGeneration.current++; comparisonAbort.current?.abort(); comparisonAbort.current = null;
      setComparing(false); setComparison(null); setPlayerComparison(null); setComparisonError("");
      generation.current++; revision.current++; portfolioBuildIds.current.clear();
      setPortfolio([]); setPortfolioLimits({}); setLineups([]); setCurrentBuild(null);
      setSavedBuild(null); setBuildSettings(null); setPortfolioSelection(null);
      setAppliedPlan(null);
      setBusy(false);
      setPortfolioRules({ version: 1, players: {}, groups: [] }); setPortfolioUndo(null);
      setPoolUpdate(null); setPoolUpdateHistory(null); poolUndo.current = null;
      poolInputVersionRef.current = 1; setPoolInputVersion(1);
      setSettings(defaultSettings);
      setContext({ site: "draftkings", season: currentMeta?.default_season ?? null, week: currentMeta?.default_week ?? null, slateId: "", source: "live" });
      workingPool.current = []; workingSalarySnapshot.current = null;
      setPool([]); setSalaries([]); setSalarySnapshot(null); setStats(null); setSlates([]); setSlateName("");
      setPoolFreshness({ checkedAt: null, refresh: null, failed: false });
      setLocked([]); setExcluded([]); setOverrides({}); setOwnership({}); setCaptainLimits({}); setProjectionImportSource(null);
      setGlobalExposure({}); setGlobalGroups([]); setGlobalUnit("percent");
      setClassicStackRules(DEFAULT_CLASSIC_STACK_RULES); setStackScope({ teams: [], qbIds: [] }); setStackWeights({});
      setWorkspaceUi({ stage: 0, view: "build" }); setSelected(0); setBuildJob(null); setError(""); setNotice("");
    };
    window.addEventListener("scoresense-auth-changed", reset);
    return () => window.removeEventListener("scoresense-auth-changed", reset);
  }, []);
  const isDfs = context.site !== "seasonal";
  const isCaptain = isCaptainFormat(context.site, formats);
  useEffect(() => {
    if (keepRestoredComparison.current) { keepRestoredComparison.current = false; return; }
    comparisonGeneration.current++;
    comparisonAbort.current?.abort();
    setComparing(false);
    setComparison(null);
    setPlayerComparison(null);
    setComparisonError("");
    return () => comparisonAbort.current?.abort();
  }, [context, settings, locked, excluded, overrides, salaries, salarySnapshot, pool, config]);
  const changeSetting = (key, value) => {
    if (key === "portfolioMode" && value === "global" && (settings.qbStack || settings.requireQbStack || settings.bringBack)) {
      setClassicStackRules({ version: 1,
        attachments: { mode: "minimum", count: Math.max(Number(settings.qbStack) || 0, settings.requireQbStack ? 1 : 0), receiving_rb_ids: [] },
        bring_back: { mode: settings.bringBack ? "minimum" : "optional", count: settings.bringBack ? 1 : 0 } });
      setNotice(GC.nativeMigration);
    }
    setSettings((s) => ({ ...s, [key]: value,
      ...(key === "portfolioMode" && value === "global" ? { qbStack: 0, bringBack: false, requireQbStack: false } : {}),
      ...(key === "qbStack" ? { requireQbStack: false } : {}) }));
  };
  const changeStackWeight = (gameId, delta) => {
    const id = String(gameId || "");
    if (!id) return;
    setStackWeights((current) => {
      const next = Math.max(0, Math.min(4, (Number(current[id]) || 0) + Number(delta || 0)));
      if (!next) {
        const copy = { ...current };
        delete copy[id];
        return copy;
      }
      return { ...current, [id]: next };
    });
    if (Number(delta) > 0) {
      setSettings((current) => ({
        ...current,
        qbStack: Math.max(1, Number(current.qbStack) || 0),
      }));
    }
  };

  useEffect(() => {
    const abort = new AbortController();
    if (!projMeta)
      jsonRequest("/api/meta/projections/qb", { signal: abort.signal })
        .then(setMeta)
        .catch((e) => {
          if (!abort.signal.aborted) setError(e.message);
        });
    jsonRequest("/api/lineup/formats", { signal: abort.signal })
      .then((d) => setFormats(current => {
        const next = d.formats || DEFAULT_FORMATS;
        return JSON.stringify(current) === JSON.stringify(next) ? current : next;
      }))
      .catch(() => {});
    return () => abort.abort();
  }, [projMeta]);
  useEffect(() => {
    if (projMeta) setMeta(projMeta);
  }, [projMeta]);
  useEffect(() => {
    if (meta)
      setContext((c) => {
        const season = c.season ?? meta.default_season, week = c.week ?? meta.default_week;
        return season === c.season && week === c.week ? c : { ...c, season, week };
      });
  }, [meta]);

  const changeContext = (patch) => {
    if (context.source === "live" && Object.entries(patch).every(([key, value]) => context[key] === value)) return;
    generation.current++;
    cancelBuild();
    revision.current++;
    restoredContext.current = false;
    setContext((c) => ({
      ...c,
      ...patch,
      slateId: patch.site ? "" : (patch.slateId ?? c.slateId),
      source: "live",
    }));
    setDataUpdateAvailable(false);
    setPoolUpdate(null); setPoolUpdateHistory(null); poolUndo.current = null;
    setPool([]);
    setSalaries([]);
    setSalarySnapshot(null);
    setStats(null);
    setPoolFreshness({ checkedAt: null, refresh: null, failed: false });
    setStackWeights({});
    setGlobalExposure({}); setPortfolioSelection(null);
    setGlobalGroups([]); setStackScope({ teams: [], qbIds: [] }); setAppliedPlan(null);
    setClassicStackRules({ version: 1, attachments: { mode: "optional", count: 0, receiving_rb_ids: [] }, bring_back: { mode: "optional", count: 0 } });
    setLineups([]);
    setSavedBuild(null);
    changeSetting("lockedCaptain", "");
    if (patch.site) setSettings(s => ({ ...s,
      ...(patch.site !== "draftkings" ? { portfolioMode: "legacy" } : {}),
      differences: normalizeLineupDifferences(s.differences, isCaptainFormat(patch.site, formats)) }));
    setLocked([]);
    setExcluded([]);
    setCaptainLimits({});
    setOverrides({});
    setOwnership({});
    setProjectionImportSource(null);
    setError("");
    setNotice("");
    if (patch.site)
      changeSetting(
        "maxSalary",
        (formats[patch.site] || DEFAULT_FORMATS[patch.site]).salary_cap || 0,
      );
  };

  useEffect(() => {
    if (!isDfs || context.source !== "live") return;
    const abort = new AbortController();
    const epoch = accountEpoch.current;
    setBusy(true);
    jsonRequest(
      `/api/lineup/slates?site=${context.site}&category=${defaultSlateCategory(context.site, formats)}`,
      { signal: abort.signal },
    )
      .then((d) => {
        if (abort.signal.aborted || epoch !== accountEpoch.current) return;
        const list = d.slates || [];
        setSlates(list);
        setContext((c) => {
          const slateId = (restoredContext.current && c.slateId) || list.some((s) => String(s.slate_id) === c.slateId)
            ? c.slateId
            : String(list[0]?.slate_id || "");
          return slateId === c.slateId ? c : { ...c, slateId };
        });
      })
      .catch((e) => {
        if (!abort.signal.aborted && epoch === accountEpoch.current) setError(e.message);
      })
      .finally(() => {
        if (!abort.signal.aborted && epoch === accountEpoch.current) setBusy(false);
      });
    return () => abort.abort();
  }, [context.site, context.source, isDfs, accountRevision]);

  useEffect(() => {
    if (context.season == null || context.week == null) {
      setVegasGames([]);
      setStackWeights({});
      return;
    }
    const abort = new AbortController();
    const epoch = accountEpoch.current;
    // Captain formats still retain scheduled starts for pre-lock export checks.
    // Game weighting stays exclusive to multi-game formats.
    if (isCaptain) setStackWeights({});
    jsonRequest(
      `/api/lineup/vegas?season=${context.season}&week=${context.week}`,
      { signal: abort.signal },
    )
      .then((data) => {
        if (!abort.signal.aborted && epoch === accountEpoch.current) setVegasGames(data.games || []);
      })
      .catch(() => {
        if (!abort.signal.aborted && epoch === accountEpoch.current) setVegasGames([]);
      });
    return () => abort.abort();
  }, [context.season, context.week, isCaptain, accountRevision]);

  const acceptPool = (data, name, background = false) => {
    // A refresh is a proposal while usable inputs exist. Reviewed builds and working controls stay put.
    // An explicitly imported catalog has priority even when the first live load is empty.
    if (pendingPoolUpdate.current?.resetStrategy) return;
    if (workingPool.current.length) {
      const diff = previewPoolUpdate(workingPool.current, data, { fromVersion: poolInputVersionRef.current });
      diff.metadataChanged = JSON.stringify(workingSalarySnapshot.current || null) !== JSON.stringify(data.salary_snapshot || null);
      if (diff.changes.length || diff.metadataChanged) {
        setPoolUpdate({ data: structuredClone(data), name, diff, resetStrategy: false });
        setNotice(WC.updateReady);
      } else {
        if (pendingPoolUpdate.current?.diff.source === "live") { setPoolUpdate(null); setNotice(C.liveRefreshed); }
        setPoolFreshness(previous => ({ ...previous, checkedAt: Date.now(), failed: false,
          refresh: data.meta?.refresh || null, recovery: data.meta?.projection_recovery,
          projectionStale: data.meta?.projection_stale }));
      }
      setDataUpdateAvailable(false);
      return;
    }
    setPool(data.players || []);
    setSalaries(data.salaries || []);
    setSalarySnapshot(data.salary_snapshot || null);
    setStats(data.stats || null);
    setPoolFreshness({ checkedAt: Date.now(), refresh: data.meta?.refresh || null,
      recovery: data.meta?.projection_recovery, projectionStale: data.meta?.projection_stale, failed: false });
    setSlateName(data.slate?.name || name || "");
    if (background) {
      setNotice(data.meta?.refresh?.stale || data.meta?.refresh?.status === "error" ? C.projectionRefreshFailed : C.liveRefreshed);
      setDataUpdateAvailable(false);
      return;
    }
    setLineups([]);
    setSavedBuild(null);
    setNotice(data.meta?.refresh?.stale || data.meta?.refresh?.status === "error" ? C.projectionRefreshFailed : "");
  };
  useEffect(() => {
    if (
      context.season == null ||
      context.week == null ||
      context.source !== "live" ||
      (isDfs && !context.slateId)
    )
      return;
    const abort = new AbortController();
    const epoch = accountEpoch.current;
    setBusy(true);
    setError("");
    const params = new URLSearchParams({
      site: context.site,
      season: context.season,
      week: context.week,
      slate_id: context.slateId,
      apply_injury_adjustments: String(
        context.season === meta?.default_season &&
          context.week === meta?.default_week,
      ),
    });
    let pending = false;
    let timer;
    let checkDelay = 300000;
    const load = (background = false) => {
      if (pending || (background && (document.hidden || activeWork.current))) return;
      pending = true;
      return jsonRequest(`/api/lineup/${isDfs ? "salaries/load" : "pool"}?${params}`, {
        signal: abort.signal,
      })
        .then((d) => {
          checkDelay = ['queued','running','busy'].includes(d.meta?.projection_recovery?.status) ? 5000 : 300000;
          if (!abort.signal.aborted && epoch === accountEpoch.current && (!background || !activeWork.current)) {
            acceptPool(d, undefined, background);
            setError("");
          }
        })
        .catch((e) => {
          if (abort.signal.aborted || epoch !== accountEpoch.current) return;
          setPoolFreshness(previous => ({ ...previous, failed: true }));
          if (background) {
            setError(C.liveRefreshFailed);
            return;
          }
          if (workingPool.current.length) { setError(C.liveRefreshFailed); return; }
          if (/No salaries returned for slate/i.test(e.message)) {
            setPool([]);
            setSalaries([]);
            setSalarySnapshot(null);
            setStats(null);
            setPoolFreshness({ checkedAt: null, refresh: null, failed: false });
            setLineups([]);
            setNotice(DFS_STEP_COPY.closedSlate);
            setError("");
            return;
          }
          setError(e.message);
        })
        .finally(() => {
          pending = false;
          if (!abort.signal.aborted && epoch === accountEpoch.current && !background) setBusy(false);
        });
    };
    const schedule = () => {
      timer = setTimeout(() => {
        Promise.resolve(load(true)).finally(() => { if (!abort.signal.aborted) schedule(); });
      }, checkDelay);
    };
    Promise.resolve(load()).finally(() => { if (!abort.signal.aborted) schedule(); });
    return () => { clearTimeout(timer); abort.abort(); };
  }, [
    context.site,
    context.season,
    context.week,
    context.slateId,
    context.source,
    isDfs,
    poolReload,
    accountRevision,
  ]);

  const importSalary = async (file) => {
    if (!file) return;
    const seq = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const d = await jsonRequest(
        `/api/lineup/salaries/import?site=${context.site}&season=${context.season}&week=${context.week}`,
        { method: "POST", body: form },
      );
      if (seq === generation.current) {
        const diff = previewPoolUpdate(workingPool.current, d, { fromVersion: poolInputVersionRef.current, source: "upload" });
        setPoolUpdate({ data: structuredClone(d), name: file.name, diff, resetStrategy: true,
          contextPatch: { source: "upload", slateId: "" } });
        setNotice(WC.salaryReady);
      }
    } catch (e) {
      if (seq === generation.current) setError(e.message);
    } finally {
      if (seq === generation.current) setBusy(false);
    }
  };
  const importProjections = async (file) => {
    if (!file) return;
    const seq = generation.current;
    const version = poolInputVersionRef.current;
    const importSerial = ++projectionImportSerial.current;
    const isCurrentImport = () => seq === generation.current && version === poolInputVersionRef.current && importSerial === projectionImportSerial.current;
    try {
      const contents = await file.text();
      if (!isCurrentImport()) return;
      const rows = parseDfsCsv(contents),
        keys = rows[0].map(headerKey);
      const columns = {
        id: keys.indexOf("id"),
        proj: keys.indexOf("proj"),
        floor: keys.indexOf("floor"),
        ceiling: keys.indexOf("ceiling"),
        own: keys.indexOf("ownership"),
      };
      if (Object.entries(columns).some(([k, v]) => k !== "own" && v < 0))
        throw new Error(
          "Use columns ID, Proj, Floor, Ceiling and optional Ownership. ID is the slate's FLEX player ID.",
        );
      const next = {},
        own = {};
      for (const row of rows.slice(1)) {
        const p = pool.find(
          (p) => String(p.dfs_id) === row[columns.id]?.trim(),
        );
        if (!p)
          throw new Error(`Player ID ${row[columns.id]} is not in this slate.`);
        const v = Object.fromEntries(
          ["proj", "floor", "ceiling"].map((k) => [
            k,
            row[columns[k]]?.trim() === "" ? NaN : Number(row[columns[k]]),
          ]),
        );
        if (
          Object.values(v).some(
            (n) => !Number.isFinite(n) || n < -20 || n > 150,
          ) ||
          v.floor > v.proj ||
          v.proj > v.ceiling
        )
          throw new Error(
            "Each row needs Floor â‰¤ Proj â‰¤ Ceiling, between -20 and 150 points.",
          );
        if (next[p.player_id])
          throw new Error("The projection file repeats a player ID.");
        next[p.player_id] = v;
        if (columns.own >= 0 && row[columns.own]?.trim()) {
          const n = Number(row[columns.own].replace("%", ""));
          if (!Number.isFinite(n) || n < 0 || n > 100)
            throw new Error("Ownership must be a percentage from 0 to 100.");
          own[p.player_id] = n;
        }
      }
      setOverrides(next);
      setOwnership(own);
      setProjectionImportSource({ name: file.name, count: Object.keys(next).length, importedAt: new Date().toISOString() });
      setNotice(
        `Imported projections for ${Object.keys(next).length} players. Rebuild to apply them.`,
      );
    } catch (e) {
      if (isCurrentImport()) setError(e.message);
    }
  };
  const toggle = (id, kind) => {
    const setter = kind === "lock" ? setLocked : setExcluded,
      other = kind === "lock" ? setExcluded : setLocked;
    setter((list) =>
      list.includes(id) ? list.filter((p) => p !== id) : [...list, id],
    );
    other((list) => list.filter((p) => p !== id));
  };
  const strategyRequest = (effectiveCount = null) => {
    const count = effectiveCount ?? parseLineupCount(settings.count);
    if (count === null) throw new Error(C.countHelp);
    const global = context.site === "draftkings" && settings.portfolioMode === "global";
    const differences = isCaptain || !isDfs ? normalizeLineupDifferences(settings.differences, isCaptain) : Number(settings.differences);
    if (!isCaptain && (!Number.isInteger(differences) || differences < (global ? 0 : 1) || differences > 9)) throw new Error("Choose a supported whole-number lineup difference.");
    if (global && Object.values(stackWeights).some(w => Number(w) > 0)) throw new Error(GC.weightConflict);
    const playerLimits = global ? exposureRequest(globalExposure, count, locked, excluded, settings.exposure) : {};
    const groups = global ? groupExposureRequest(globalGroups, count, locked, excluded, globalExposure, settings.exposure, pool) : [];
    return {
      site: context.site, season: context.season, week: context.week,
      slate_id: context.slateId || null, salary_snapshot_id: salarySnapshot?.id || null,
      portfolio_mode: global ? "global" : "legacy", lineup_count: count, objective: settings.objective,
      salary_cap: isDfs ? Math.min(Number(settings.maxSalary), Number(config.salary_cap)) : null,
      min_salary: settings.minSalary || null, max_per_team: settings.maxTeam || null,
      max_overlap: Math.max(0, (isCaptain ? 6 : isDfs ? 9 : 7) - differences),
      max_exposure: settings.exposure, randomness: settings.randomness,
      locked_player_ids: locked, excluded_player_ids: excluded,
      qb_stack_count: isCaptain || global ? 0 : settings.qbStack, stack_bring_back: !isCaptain && !global && settings.bringBack,
      require_qb_stack: !isCaptain && !global && settings.requireQbStack,
      stack_teams: isCaptain ? [] : stackScope.teams, stack_qb_ids: isCaptain ? [] : stackScope.qbIds,
      stack_game_weights: !isCaptain ? slateGames(vegasGames, pool).filter(game => Number(stackWeights[game.game_id]) > 0)
        .map(game => ({ game_id: String(game.game_id), teams: gameTeamCodes(game), weight: Number(stackWeights[game.game_id]) })) : [],
      classic_stack_rules: global ? normalizeClassicStackRules(classicStackRules, pool) : null,
      player_exposure_limits: playerLimits, group_exposure_limits: groups,
      block_qb_opposing_dst: settings.blockQbDst,
    };
  };
  const run = async (mode, forcedPlayer = null) => {
    const comparingPlayer = mode === "compare-player";
    const comparingCaptains = mode === "compare" || comparingPlayer;
    if (comparingCaptains && !isCaptain) return;
    const lineupCount = comparingCaptains ? 1 : parseLineupCount(settings.count);
    if (lineupCount === null) {
      setError(C.countHelp);
      return;
    }
    let strategy;
    try { strategy = strategyRequest(comparingCaptains ? 1 : null); if (appliedPlan) assertBuildPlanApplied(appliedPlan.manifest, strategy); }
    catch (e) { setError(e.message); return; }
    const comparisonSeq = comparingCaptains ? ++comparisonGeneration.current : null;
    const seq = generation.current;
    const jobSeq = comparingCaptains ? null : ++buildGeneration.current;
    if (comparingCaptains) {
      comparisonAbort.current?.abort();
      comparisonAbort.current = new AbortController();
      setComparing(true);
      setComparisonStartedAt(Date.now());
      setComparisonError("");
    } else {
      buildAbort.current?.abort();
      buildAbort.current = new AbortController();
      revision.current++;
      setBuilding(true);
      setError("");
      setNotice("");
      setBuildJob({ status: "running", stage: "request", startedAt: Date.now(), requested: lineupCount });
    }
    const cap = isDfs
      ? Math.min(Number(settings.maxSalary), Number(config.salary_cap))
      : null;
    let request = {
      ...strategy,
      site: context.site,
      slate_id: context.slateId || null,
      season: context.season,
      week: context.week,
      slate_salaries: salaries,
      salary_snapshot_id: salarySnapshot?.id || null,
      locked_captain_id: isCaptain ? settings.lockedCaptain || null : null,
      captain_exposure_limits: isCaptain ? captainLimits : {},
      projection_overrides: overrides,
      apply_injury_adjustments:
        context.season === meta?.default_season &&
        context.week === meta?.default_week,
      block_bye_weeks: true,
      ...(context.site === "draftkings_showdown" && settings.showdownRules ? { showdown_rules: settings.showdownRules } : {}),
    };
    if (comparingCaptains && currentBuild?.settings?.build_snapshot) {
      // Use only supported request keys from the immutable original build.
      const saved = currentBuild.settings;
      request = { ...request, ...Object.fromEntries(Object.keys(request).filter(key => Object.hasOwn(saved, key)).map(key => [key, saved[key]])),
        comparison_snapshot: saved.build_snapshot };
      if (!Object.hasOwn(saved, "showdown_rules")) delete request.showdown_rules;
    }
    try {
      if (
        isDfs &&
        (!salaries.length ||
          !Number.isFinite(cap) ||
          cap <= 0 ||
          settings.minSalary > cap)
      )
        throw new Error(
          "Load salaries and check the salary range before building.",
        );
      const data = await jsonRequest("/api/lineup/optimize", {
        method: "POST",
        body: JSON.stringify(comparingCaptains ? { ...captainComparisonRequest(request),
          ...(comparingPlayer ? { include_captain_comparison: false, comparison_player_id: forcedPlayer?.playerId, comparison_player_slot: forcedPlayer?.slot } : {}) } : request),
        signal: comparingCaptains ? comparisonAbort.current.signal : buildAbort.current.signal,
      });
      if (comparingCaptains) {
        if (comparisonSeq !== comparisonGeneration.current) return;
        if (!data.ok) throw new Error(data.error || CC.failure);
        const report = comparingPlayer ? data.player_comparison : data.captain_comparison;
        if (!data.build_snapshot?.id || report?.snapshot_id !== data.build_snapshot.id ||
            (request.comparison_snapshot && data.comparison_source_snapshot_id !== request.comparison_snapshot.id))
          throw new Error(CC.mismatch);
        const result = { ...report, captured_at: data.build_snapshot.captured_at, source_snapshot_id: data.comparison_source_snapshot_id || data.build_snapshot.id };
        if (comparingPlayer) setPlayerComparison(result); else setComparison(result);
        return;
      }
      if (seq !== generation.current || jobSeq !== buildGeneration.current) return;
      setPortfolioSelection(data.portfolio_selection || null);
      if (!data.ok)
        throw new Error(data.error || "No lineup satisfies these settings.");
      const builtRaw = data.lineups || [
        {
          lineup: data.lineup,
          total_salary: data.total_salary,
          total_points: data.total_points,
          score_metadata: data.score_metadata || showdownScoreMetadata(data),
          construction_audit: data.construction_audit || data.showdown_review?.lineups?.[0]?.findings,
          showdown_rules: data.showdown_rules,
        },
      ];
      const built = isCaptain ? builtRaw.map((entry, index) => ({ ...entry, score_metadata: entry.score_metadata || showdownScoreMetadata(entry),
        construction_audit: entry.construction_audit || data.showdown_review?.lineups?.[index]?.findings || [] })) : builtRaw;
      revision.current++;
      setLineups(built);
      setSelected(0);
      setSavedBuild(null);
      const originalSettings = {
        ...request,
        note: settings.note,
        ownership,
        projection_sources: Object.fromEntries(
          pool.map((p) => [
            p.player_id,
            overrides[p.player_id] ? "Imported" : p.projection_source,
          ]),
        ),
        ...(projectionImportSource ? { projection_import: projectionImportSource } : {}),
        build_snapshot: data.build_snapshot || null,
        ...(data.showdown_rules ? { resolved_showdown_rules: data.showdown_rules } : {}),
        game_schedule: vegasGames.map(game => ({ game_id: String(game.game_id || ""), home: String(game.home || ""), away: String(game.away || ""), kickoff_et: game.kickoff_et || null })),
        snapshot_at: data.build_snapshot?.captured_at || new Date().toISOString(),
        ...(data.portfolio_selection ? { portfolio_selection: data.portfolio_selection } : {}),
        ...(appliedPlan ? { plan_manifest: appliedPlan.manifest } : {}),
      };
      setBuildSettings(originalSettings);
      setCurrentBuild(freezeSnapshot({ context, slateName, lineups: built,
        settings: originalSettings, salaryCatalog: pool, salarySnapshot }));
      setBuildJob(job => ({ ...job, status: built.length < lineupCount ? "partial" : "complete", finishedAt: Date.now(), generated: built.length }));
      setNotice(
        built.length < settings.count
          ? `Built ${built.length} of ${settings.count}. Limits count toward the requested set; review actual exposure before exporting. ${data.note || ""}`
          : `Built ${built.length} lineup${built.length === 1 ? "" : "s"}.`,
      );
    } catch (e) {
      if (comparingCaptains) {
        if (comparisonSeq === comparisonGeneration.current && e.name !== "AbortError") setComparisonError(e.message || CC.failure);
      } else if (seq === generation.current && jobSeq === buildGeneration.current && e.name !== "AbortError") {
        setError(e.message);
        setBuildJob(job => ({ ...job, status: "failed", finishedAt: Date.now() }));
      }
    } finally {
      if (comparingCaptains) {
        if (comparisonSeq === comparisonGeneration.current) setComparing(false);
      } else if (jobSeq === buildGeneration.current) { setBuilding(false); buildAbort.current = null; }
    }
  };
  const save = async (rethrow = false) => {
    const version = revision.current;
    try {
      const payload = {
        site: currentBuild?.context.site || context.site,
        slate_id: currentBuild?.context.slateId || context.slateId,
        slate_name: currentBuild?.slateName || slateName,
        lineups: currentBuild?.lineups || lineups,
        settings: currentBuild?.settings || buildSettings || {},
        note: currentBuild?.settings.note || buildSettings?.note || "",
      };
      const key = await stableBuildKey(payload);
      if (version !== revision.current) return null;
      const saved = await jsonRequest("/api/lineup/builds", {
        method: "POST",
        body: JSON.stringify({ ...payload, idempotency_key: key }),
      });
      if (version !== revision.current) return null;
      setSavedBuild(saved);
      setNotice("Build saved with its original projections and settings.");
      return saved;
    } catch (e) {
      setError(e.message);
      if (rethrow === true) throw e;
      return null;
    }
  };
  const visiblePool = pool.map((p) =>
    overrides[p.player_id]
      ? {
          ...p,
          "Projected Points": overrides[p.player_id].proj,
          "Low (P10)": overrides[p.player_id].floor,
          "High (P90)": overrides[p.player_id].ceiling,
          projection_source: "Imported",
        }
      : p,
  );
  const workingControls = () => ({ settings, locked, excluded, overrides, ownership, projectionImportSource, captainLimits,
    stackWeights, globalExposure, globalGroups, classicStackRules, stackScope, appliedPlan, globalUnit });
  const restoreControls = state => {
    setSettings(state.settings); setLocked(state.locked); setExcluded(state.excluded); setOverrides(state.overrides);
    setOwnership(state.ownership); setProjectionImportSource(state.projectionImportSource || null); setCaptainLimits(state.captainLimits); setStackWeights(state.stackWeights);
    setGlobalExposure(state.globalExposure); setGlobalGroups(state.globalGroups); setClassicStackRules(state.classicStackRules);
    setStackScope(state.stackScope); setAppliedPlan(state.appliedPlan); setGlobalUnit(state.globalUnit);
  };
  const resetControlsForCatalog = () => ({ ...workingControls(), settings: { ...settings, lockedCaptain: "" },
    locked: [], excluded: [], overrides: {}, ownership: {}, projectionImportSource: null, captainLimits: {}, stackWeights: {}, globalExposure: {},
    globalGroups: [], classicStackRules: DEFAULT_CLASSIC_STACK_RULES, stackScope: { teams: [], qbIds: [] }, appliedPlan: null });
  const applyPoolUpdate = () => {
    try {
      if (!poolUpdate || building || busy) return;
      if (poolUpdate.diff.beforeKey !== poolVersion(pool) || poolUpdate.diff.fromVersion !== poolInputVersionRef.current) throw new Error(WC.staleUpdate);
      const previous = structuredClone({ pool, salaries, salarySnapshot, stats, poolFreshness, slateName, context, controls: workingControls() });
      const { data, resetStrategy, contextPatch } = poolUpdate;
      const nextControls = resetStrategy ? resetControlsForCatalog() : workingControls();
      const nextContext = { ...context, ...contextPatch };
      revision.current++;
      poolUndo.current = { previous, revision: revision.current, afterPoolKey: poolVersion(data.players),
        afterContext: JSON.stringify(nextContext), afterControls: JSON.stringify(nextControls) };
      restoreControls(nextControls);
      setPool(data.players); setSalaries(data.salaries || []); setSalarySnapshot(data.salary_snapshot || null);
      setStats(data.stats || null); setSlateName(data.slate?.name || poolUpdate.name || slateName);
      setPoolFreshness({ checkedAt: Date.now(), refresh: data.meta?.refresh || null,
        recovery: data.meta?.projection_recovery, projectionStale: data.meta?.projection_stale, failed: false });
      if (contextPatch) setContext(nextContext);
      poolInputVersionRef.current++;
      setPoolInputVersion(poolInputVersionRef.current);
      setPoolUpdateHistory(freezeSnapshot({ ...poolUpdate.diff, resetStrategy, appliedAt: new Date().toISOString() }));
      setPoolUpdate(null); setDataUpdateAvailable(false); setNotice(WC.updated); setError("");
    } catch (e) { setError(e.message); }
  };
  const undoPoolUpdate = () => {
    try {
      const undo = poolUndo.current;
      if (!undo || building || busy) return;
      if (undo.revision !== revision.current || undo.afterPoolKey !== poolVersion(pool) || undo.afterContext !== JSON.stringify(context) || undo.afterControls !== JSON.stringify(workingControls()))
        throw new Error(WC.staleUndo);
      const p = undo.previous;
      revision.current++;
      setPool(p.pool); setSalaries(p.salaries); setSalarySnapshot(p.salarySnapshot); setStats(p.stats);
      setPoolFreshness(p.poolFreshness); setSlateName(p.slateName); setContext(p.context); restoreControls(p.controls);
      poolInputVersionRef.current++; setPoolInputVersion(poolInputVersionRef.current);
      setPoolUpdateHistory(freezeSnapshot({ ...poolUpdateHistory, undoneAt: new Date().toISOString(), undoneAsVersion: poolInputVersionRef.current }));
      setPoolUpdate(null); poolUndo.current = null; setNotice(WC.updateUndone); setError("");
    } catch (e) { setError(e.message); }
  };
  let planMatches = true;
  if (appliedPlan) { try { assertBuildPlanApplied(appliedPlan.manifest, strategyRequest()); } catch { planMatches = false; } }
  return {
    navigationDraftRestored: Boolean(initial),
    workspaceUi,
    changeWorkspaceUi: (key, value) => setWorkspaceUi(current => ({ ...current, [key]: value })),
    currentBuild: lineups.length ? currentBuild : null,
    portfolio,
    portfolioLimits,
    portfolioRules,
    setPortfolioRule: (id, kind, value) => { if (kind === "max") setPortfolioLimits(r => { const next = { ...r }; delete next[id]; return next; });
      setPortfolioRules(r => ({ ...r, players: { ...r.players, [id]: { ...r.players[id], [kind]: value } } })); },
    setPortfolioGroupRule: (id, kind, value) => setPortfolioRules(r => ({ ...r, groups: r.groups.map(g => g.id === id ? { ...g, [kind]: value } : g) })),
    addPortfolioRuleGroup: group => setPortfolioRules(r => ({ ...r, groups: [...r.groups, group] })),
    removePortfolioRuleGroup: id => setPortfolioRules(r => ({ ...r, groups: r.groups.filter(g => g.id !== id) })),
    clearPortfolioRules: () => setPortfolioRules({ version: 1, players: {}, groups: [] }),
    canUndoPortfolioReplacement: Boolean(portfolioUndo),
    replacePortfolioBatch: preview => {
      try {
        const next = applyPortfolioReplacement(preview, portfolio, lineups.length ? currentBuild : null, portfolioLimits, portfolioRules);
        setPortfolioUndo({ batches: portfolio, limits: portfolioLimits, rules: portfolioRules, next, rulesKey: JSON.stringify(portfolioRules), limitsKey: JSON.stringify(portfolioLimits) });
        revision.current++; portfolioBuildIds.current.clear(); setPortfolio(next);
        setPortfolioRestoreRevision(n => n + 1); setNotice(WC.replaced); setError(""); return true;
      } catch (e) { setError(e.message); return false; }
    },
    undoPortfolioReplacement: () => {
      if (!portfolioUndo) return;
      if (portfolioUndo.next !== portfolio || portfolioUndo.rulesKey !== JSON.stringify(portfolioRules) || portfolioUndo.limitsKey !== JSON.stringify(portfolioLimits)) { setError(WC.staleUndo); return; }
      revision.current++; portfolioBuildIds.current.clear(); setPortfolio(portfolioUndo.batches);
      setPortfolioLimits(portfolioUndo.limits); setPortfolioRules(portfolioUndo.rules); setPortfolioUndo(null);
      setPortfolioRestoreRevision(n => n + 1); setNotice(WC.replacementUndone); setError("");
    },
    globalExposure,
    globalGroups,
    classicStackRules,
    stackScope,
    changeClassicStack: (section, patch) => setClassicStackRules(current => { const rules = current || DEFAULT_CLASSIC_STACK_RULES;
      return { ...rules, [section]: { ...rules[section], ...patch } }; }),
    addGlobalGroup: group => setGlobalGroups(current => [...current, group]),
    removeGlobalGroup: id => setGlobalGroups(current => current.filter(g => g.id !== id)),
    setGlobalGroup: (id, kind, value) => setGlobalGroups(current => current.map(g => {
      if (g.id !== id) return g;
      const next = { ...g, [kind]: value }; if (kind === "target") delete next.target_exact_count; return next;
    })),
    getStrategyRequest: strategyRequest,
    buildPlanValidation: { catalog: visiblePool, context, salarySnapshot, games: slateGames(vegasGames, pool) },
    appliedPlan,
    planMatches,
    releaseBuildPlan: () => setAppliedPlan(null),
    applyBuildPlanInputs: result => {
      const inputs = result.inputs;
      const playerRules = Object.fromEntries(Object.entries(inputs.player_exposure_limits).map(([id, r]) => [id, exposureRuleFromRequest(r, inputs.lineup_count)]));
      const groupRules = inputs.group_exposure_limits.map(g => ({ id: g.id, label: g.player_ids.map(id => pool.find(p => p.player_id === id)?.Player || id).join(" + "),
        player_ids: [...g.player_ids], ...exposureRuleFromRequest(g, inputs.lineup_count) }));
      const manifest = assertBuildPlanApplied(result.manifest, { ...inputs,
        player_exposure_limits: exposureRequest(playerRules, inputs.lineup_count),
        group_exposure_limits: groupExposureRequest(groupRules, inputs.lineup_count, inputs.locked_player_ids, inputs.excluded_player_ids, playerRules, inputs.max_exposure, pool) });
      // Validation happens before this synchronous React batch; no partial application is observable.
      setSettings(current => ({ ...current, portfolioMode: inputs.portfolio_mode, count: inputs.lineup_count,
        objective: inputs.objective, maxSalary: inputs.salary_cap, minSalary: inputs.min_salary || 0,
        maxTeam: inputs.max_per_team || 0, differences: 9 - inputs.max_overlap, exposure: inputs.max_exposure,
        randomness: inputs.randomness, qbStack: inputs.qb_stack_count, requireQbStack: inputs.require_qb_stack, bringBack: inputs.stack_bring_back,
        blockQbDst: inputs.block_qb_opposing_dst }));
      setLocked([...inputs.locked_player_ids]); setExcluded([...inputs.excluded_player_ids]);
      setStackWeights(Object.fromEntries(inputs.stack_game_weights.map(g => [g.game_id, g.weight])));
      setStackScope({ teams: [...inputs.stack_teams], qbIds: [...inputs.stack_qb_ids] });
      setGlobalUnit("count");
      setGlobalExposure(playerRules); setGlobalGroups(groupRules);
      setClassicStackRules(inputs.classic_stack_rules);
      setAppliedPlan({ manifest, label: result.label || result.manifest.planId });
      setError("");
    },
    globalUnit,
    portfolioSelection,
    setGlobalUnit: unit => {
      try {
        const players = convertExposureUnits(globalExposure, Number(settings.count), unit);
        const groups = globalGroups.map(g => ({ ...g, ...convertExposureUnits({ [g.id]: g }, Number(settings.count), unit)[g.id] }));
        setGlobalExposure(players); setGlobalGroups(groups); setGlobalUnit(unit);
      }
      catch (e) { setError(e.message); }
    },
    setGlobalExposure: (id, kind, value) => setGlobalExposure(current => {
      const next = { ...current[id], unit: globalUnit, [kind]: value }; if (kind === "target") delete next.target_exact_count;
      return { ...current, [id]: next };
    }),
    clearGlobalExposure: () => { setGlobalExposure({}); setGlobalGroups([]); },
    portfolioRestoreRevision,
    replacePortfolio: (backup) => {
      revision.current++;
      portfolioBuildIds.current.clear();
      setPortfolio(backup.batches);
      setPortfolioLimits(backup.appearanceLimits);
      setPortfolioRules(backup.reviewRules || { version: 1, players: {}, groups: [] }); setPortfolioUndo(null);
      setPortfolioRestoreRevision(n => n + 1);
      setNotice(PC.restored);
      setError("");
    },
    setPortfolioLimit: (id, value) => setPortfolioLimits(current => ({ ...current, [id]: value })),
    clearPortfolioLimits: () => setPortfolioLimits({}),
    addPortfolioBatch: (label) => {
      try {
        const batch = createPortfolioBatch(lineups.length ? currentBuild : null, label);
        revision.current++;
        setPortfolio(appendPortfolioBatch(portfolio, batch));
        setPortfolioUndo(null);
        setError("");
        return true;
      } catch (e) { setError(e.message); return false; }
    },
    removePortfolioBatch: (id) => { revision.current++; setPortfolioUndo(null); const next = removePortfolioBatch(portfolio, id); setPortfolio(next);
      if (!next.length) { setPortfolioRules({ version: 1, players: {}, groups: [] }); setPortfolioLimits({}); } },
    savePortfolioBatch: async (batch) => {
      const version = revision.current, accountGeneration = generation.current;
      const requireCurrent = () => {
        if (version !== revision.current || accountGeneration !== generation.current) throw new Error(GC.staleExport);
      };
      if (!portfolioBuildIds.current.has(batch.id)) {
        const payload = portfolioBuildPayload(batch);
        const key = await stableBuildKey(payload);
        requireCurrent();
        const saved = await jsonRequest("/api/lineup/builds", { method: "POST",
          body: JSON.stringify({ ...payload, idempotency_key: key }) });
        requireCurrent();
        portfolioBuildIds.current.set(batch.id, saved.id);
      }
      return portfolioBuildIds.current.get(batch.id);
    },
    dataUpdateAvailable,
    poolUpdate, poolUpdateHistory, poolInputVersion,
    applyPoolUpdate, undoPoolUpdate,
    canUndoPoolUpdate: Boolean(poolUndo.current),
    dismissPoolUpdate: () => { setPoolUpdate(null); setNotice(WC.updateKept); },
    reloadPlayerPool: () => {
      generation.current++;
      revision.current++;
      setDataUpdateAvailable(false);
      setPoolReload((n) => n + 1);
    },
    meta,
    formats,
    context,
    changeContext,
    slates,
    pool: visiblePool,
    salaries,
    stats,
    poolFreshness,
    vegasGames,
    stackWeights,
    changeStackWeight,
    clearStackWeights: () => setStackWeights({}),
    slateName,
    busy,
    building,
    buildJob, cancelBuild,
    comparing,
    comparison,
    comparisonError,
    playerComparison, comparisonStartedAt,
    cancelComparison: () => {
      comparisonGeneration.current++; comparisonAbort.current?.abort(); comparisonAbort.current = null;
      setComparing(false); setComparisonError(SC.cancelled);
    },
    comparePlayer: (playerId, slot) => run("compare-player", { playerId, slot }),
    compareCaptains: () => run("compare"),
    error,
    setError,
    notice,
    lineups,
    selected,
    setSelected,
    savedBuild,
    save,
    locked,
    excluded,
    toggle,
    overrides,
    ownership,
    projectionImportSource,
    captainLimits,
    setCaptainLimits,
    settings,
    changeSetting,
    config,
    isDfs,
    isCaptain,
    importSalary,
    importProjections,
    run,
  };
}
