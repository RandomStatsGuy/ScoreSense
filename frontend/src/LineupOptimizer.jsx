import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch, PRODUCT_DISCLAIMER } from "./auth";
import { connectionErrorMessage, fmtNum, isPlayerUnavailable, parseApiError } from "./format";
import useMobileLayout from "./useMobileLayout";
import MobileSubnav from "./layout/MobileSubnav";
import MobileDataList, { MobileStat } from "./MobileDataList";
import MobilePlayerCard from "./MobilePlayerCard";
import PlayerCell, { usePlayerMedia } from "./PlayerCell";

const OBJECTIVES = [
  { id: "median", label: "Proj (P50)", hint: "Maximize expected points" },
  { id: "floor", label: "Floor (P10)", hint: "Safer lineup for close matchups" },
  { id: "ceiling", label: "Ceiling (P90)", hint: "Upside-chasing lineup" },
  { id: "value", label: "Value (pts/$1k)", hint: "DFS: maximize points per salary dollar", dfsOnly: true },
];

const DEFAULT_FORMATS = {
  seasonal: {
    label: "Season-long PPR",
    description: "1 QB · 2 RB · 2 WR · 1 TE · 1 FLEX",
    salary_cap: null,
  },
  draftkings: {
    label: "DraftKings Classic",
    description: "QB · 2 RB · 3 WR · TE · FLEX · DST",
    salary_cap: 50000,
  },
  fanduel: {
    label: "FanDuel Classic",
    description: "QB · 2 RB · 3 WR · TE · FLEX · DST",
    salary_cap: 60000,
  },
};

function formatSalary(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return `$${Number(value).toLocaleString()}`;
}

function rosterHint(site, formats) {
  const cfg = formats[site] || DEFAULT_FORMATS[site] || DEFAULT_FORMATS.seasonal;
  return cfg.description || "";
}

export default function LineupOptimizer({ projMeta, loading: parentLoading }) {
  const [localMeta, setLocalMeta] = useState(null);
  const activeMeta = projMeta || localMeta;
  const [formats, setFormats] = useState(DEFAULT_FORMATS);
  const [pool, setPool] = useState([]);
  const [poolMeta, setPoolMeta] = useState(null);
  const [poolNote, setPoolNote] = useState("");
  const [season, setSeason] = useState(null);
  const [week, setWeek] = useState(null);
  const [site, setSite] = useState("seasonal");
  const [slateCategory, setSlateCategory] = useState("main");
  const [slates, setSlates] = useState([]);
  const [selectedSlateId, setSelectedSlateId] = useState("");
  const [slateMeta, setSlateMeta] = useState(null);
  const [loadingSlates, setLoadingSlates] = useState(false);
  const [loadingSalaries, setLoadingSalaries] = useState(false);
  const [salaryCap, setSalaryCap] = useState("");
  const [slateSalaries, setSlateSalaries] = useState(null);
  const [importStats, setImportStats] = useState(null);
  const [objective, setObjective] = useState("median");
  const [locked, setLocked] = useState(() => new Set());
  const [excluded, setExcluded] = useState(() => new Set());
  const [lineup, setLineup] = useState([]);
  const [lineups, setLineups] = useState([]);
  const [activeLineupIdx, setActiveLineupIdx] = useState(0);
  const [requireQbStack, setRequireQbStack] = useState(false);
  const [lineupCount, setLineupCount] = useState(1);
  const [maxOverlap, setMaxOverlap] = useState(4);
  const [blockByeWeeks, setBlockByeWeeks] = useState(true);
  const [optimizeNote, setOptimizeNote] = useState("");
  const [totalPoints, setTotalPoints] = useState(null);
  const [totalSalary, setTotalSalary] = useState(null);
  const [salaryRemaining, setSalaryRemaining] = useState(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [error, setError] = useState("");
  const [posFilter, setPosFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const fileInputRef = useRef(null);

  const isDfs = site !== "seasonal";
  const mobileLayout = useMobileLayout();
  const [mobileStep, setMobileStep] = useState("setup");
  const resultRef = useRef(null);
  const siteConfig = formats[site] || DEFAULT_FORMATS[site] || DEFAULT_FORMATS.seasonal;

  const weekOptions = useMemo(() => {
    if (!activeMeta || season == null) return [];
    return activeMeta.weeks_by_season?.[String(season)] || [];
  }, [activeMeta, season]);

  const isLiveContext = useMemo(() => {
    if (!activeMeta || season == null || week == null) return false;
    return season === activeMeta.default_season && week === activeMeta.default_week;
  }, [activeMeta, season, week]);

  const objectiveOptions = useMemo(
    () => OBJECTIVES.filter((o) => !o.dfsOnly || isDfs),
    [isDfs]
  );

  useEffect(() => {
    if (projMeta) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch("/api/meta/projections/qb");
        if (!cancelled && res.ok) {
          setLocalMeta(await res.json());
        }
      } catch {
        /* optional during dev */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projMeta]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch("/api/lineup/formats");
        if (!cancelled && res.ok) {
          const data = await res.json();
          if (data.formats) setFormats(data.formats);
        }
      } catch {
        /* optional */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!activeMeta) return;
    setSeason((prev) => prev ?? activeMeta.default_season);
    setWeek((prev) => prev ?? activeMeta.default_week);
  }, [activeMeta]);

  useEffect(() => {
    const cap = siteConfig.salary_cap;
    setSalaryCap(cap != null ? String(cap) : "");
    if (site === "seasonal" && objective === "value") setObjective("median");
    setSlateSalaries(null);
    setImportStats(null);
    setSlates([]);
    setSelectedSlateId("");
    setSlateMeta(null);
  }, [site, siteConfig.salary_cap, objective]);

  const loadSalaries = useCallback(
    async (slateId, { forceRefresh = false } = {}) => {
      if (!isDfs || season == null || week == null) return;
      const targetSlateId = slateId || selectedSlateId;
      if (!targetSlateId) return;

      setLoadingSalaries(true);
      setError("");
      try {
        const live = isLiveContext;
        const params = new URLSearchParams({
          site,
          season: String(season),
          week: String(week),
          apply_injury_adjustments: String(live),
          slate_id: targetSlateId,
        });
        if (forceRefresh) params.set("force_refresh", "true");
        const res = await apiFetch(`/api/lineup/salaries/load?${params}`);
        if (!res.ok) throw new Error(await parseApiError(res, "Failed to load slate salaries"));
        const data = await res.json();
        setPool(data.players || []);
        setPoolMeta(data.meta || null);
        setPoolNote(data.note || "");
        setSlateSalaries(data.salaries || []);
        setImportStats(data.stats || null);
        setSlateMeta(data.slate || null);
        setLineup([]);
        setLineups([]);
        setTotalPoints(null);
        setTotalSalary(null);
        setSalaryRemaining(null);
        setOptimizeNote("");
      } catch (err) {
        setError(connectionErrorMessage(err, "Failed to load slate salaries"));
      } finally {
        setLoadingSalaries(false);
      }
    },
    [isDfs, season, week, site, selectedSlateId, isLiveContext]
  );

  const fetchSlates = useCallback(async (currentSlateId = "") => {
    if (!isDfs) return "";
    setLoadingSlates(true);
    try {
      const res = await apiFetch(`/api/lineup/slates?site=${site}&category=${slateCategory}`);
      if (!res.ok) throw new Error(await parseApiError(res, "Failed to load slates"));
      const data = await res.json();
      const nextSlates = data.slates || [];
      setSlates(nextSlates);
      const defaultId = data.default_slate_id || nextSlates[0]?.slate_id || "";
      const keepCurrent = nextSlates.some((s) => String(s.slate_id) === String(currentSlateId));
      const slateId = keepCurrent ? String(currentSlateId) : String(defaultId || "");
      setSelectedSlateId(slateId);
      return slateId;
    } catch (err) {
      setSlates([]);
      setSelectedSlateId("");
      setError(connectionErrorMessage(err, "Failed to load DFS slates"));
      return "";
    } finally {
      setLoadingSlates(false);
    }
  }, [isDfs, site, slateCategory]);

  useEffect(() => {
    if (!isDfs || season == null || week == null) return;
    let cancelled = false;
    (async () => {
      const slateId = await fetchSlates("");
      if (!cancelled && slateId) {
        await loadSalaries(slateId);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isDfs, site, slateCategory, season, week, fetchSlates, loadSalaries]);

  const fetchPool = useCallback(async () => {
    if (isDfs) return;
    if (season == null || week == null) return;
    setLoading(true);
    setError("");
    try {
      const live = isLiveContext;
      const res = await apiFetch(
        `/api/lineup/pool?season=${season}&week=${week}&site=${site}&apply_injury_adjustments=${live}`
      );
      if (!res.ok) throw new Error(await parseApiError(res, "Failed to load player pool"));
      const data = await res.json();
      setPool(data.players || []);
      setPoolMeta(data.meta || null);
      setPoolNote(data.note || "");
      if (!slateSalaries) {
        setLineup([]);
      setLineups([]);
        setTotalPoints(null);
        setTotalSalary(null);
        setSalaryRemaining(null);
        setOptimizeNote("");
      }
    } catch (err) {
      setPool([]);
      setPoolMeta(null);
      setError(connectionErrorMessage(err, "Failed to load player pool"));
    } finally {
      setLoading(false);
    }
  }, [season, week, isLiveContext, site, slateSalaries, isDfs]);

  useEffect(() => {
    fetchPool();
  }, [fetchPool]);

  const handleSalaryImport = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || season == null || week == null) return;
    if (!isDfs) return;

    setImporting(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const live = isLiveContext;
      const res = await apiFetch(
        `/api/lineup/salaries/import?site=${site}&season=${season}&week=${week}&apply_injury_adjustments=${live}`,
        { method: "POST", body: form }
      );
      if (!res.ok) throw new Error(await parseApiError(res, "Salary import failed"));
      const data = await res.json();
      setPool(data.players || []);
      setPoolMeta(data.meta || null);
      setPoolNote(data.note || "");
      setSlateSalaries(data.salaries || []);
      setImportStats(data.stats || null);
      setLineup([]);
      setLineups([]);
      setTotalPoints(null);
      setTotalSalary(null);
      setSalaryRemaining(null);
    } catch (err) {
      setError(connectionErrorMessage(err, "Salary import failed"));
    } finally {
      setImporting(false);
    }
  };

  const toggleLock = (playerId) => {
    setLocked((prev) => {
      const next = new Set(prev);
      if (next.has(playerId)) next.delete(playerId);
      else next.add(playerId);
      return next;
    });
    setExcluded((prev) => {
      const next = new Set(prev);
      next.delete(playerId);
      return next;
    });
  };

  const toggleExclude = (playerId) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(playerId)) next.delete(playerId);
      else next.add(playerId);
      return next;
    });
    setLocked((prev) => {
      const next = new Set(prev);
      next.delete(playerId);
      return next;
    });
  };

  const runOptimize = async () => {
    if (season == null || week == null) return;
    if (isDfs && !slateSalaries?.length) {
      setError("Salaries are still loading — pick a slate or import a CSV.");
      return;
    }
    setOptimizing(true);
    setError("");
    try {
      const cap = salaryCap.trim() ? Number(salaryCap) : null;
      const res = await apiFetch("/api/lineup/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          season,
          week,
          site,
          objective,
          salary_cap: cap,
          slate_salaries: slateSalaries,
          locked_player_ids: [...locked],
          excluded_player_ids: [...excluded],
          apply_injury_adjustments: isLiveContext,
          require_qb_stack: requireQbStack,
          lineup_count: lineupCount,
          max_overlap: maxOverlap,
          block_bye_weeks: blockByeWeeks,
        }),
      });
      if (!res.ok) throw new Error(await parseApiError(res, "Optimization failed"));
      const data = await res.json();
      if (!data.ok) {
        setLineup([]);
        setLineups([]);
        setActiveLineupIdx(0);
        setTotalPoints(null);
        setTotalSalary(null);
        setSalaryRemaining(null);
        setError(data.error || "Could not build a valid lineup.");
        return;
      }
      if (data.lineups?.length) {
        setLineups(data.lineups);
        setActiveLineupIdx(0);
        const first = data.lineups[0];
        setLineup(first?.lineup || []);
        setTotalPoints(first?.total_points);
        setTotalSalary(first?.total_salary);
        setSalaryRemaining(first?.salary_remaining);
      } else {
        setLineups([]);
        setActiveLineupIdx(0);
        setLineup(data.lineup || []);
        setTotalPoints(data.total_points);
        setTotalSalary(data.total_salary);
        setSalaryRemaining(data.salary_remaining);
      }
      setOptimizeNote(data.note || "");
      if (mobileLayout) {
        setMobileStep("result");
        window.setTimeout(() => {
          resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 120);
      }
    } catch (err) {
      setLineup([]);
      setLineups([]);
      setTotalPoints(null);
      setTotalSalary(null);
      setSalaryRemaining(null);
      setError(connectionErrorMessage(err, "Optimization failed"));
    } finally {
      setOptimizing(false);
    }
  };

  const filteredPool = useMemo(() => {
    let list = pool || [];
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((r) => String(r.Player || "").toLowerCase().includes(q));
    if (posFilter !== "ALL") list = list.filter((r) => r.Position === posFilter);
    return list;
  }, [pool, search, posFilter]);

  const narrativePlayerIds = useMemo(() => {
    const ids = new Set();
    (pool || []).forEach((r) => {
      if (r.player_id) ids.add(String(r.player_id));
    });
    lineup.forEach((r) => {
      if (r.player_id) ids.add(String(r.player_id));
    });
    return [...ids];
  }, [pool, lineup]);
  const playerMedia = usePlayerMedia(narrativePlayerIds);

  const handleSeasonChange = (nextSeason) => {
    const s = Number(nextSeason);
    setSeason(s);
    const weeks = activeMeta?.weeks_by_season?.[String(s)] || [];
    if (weeks.length) {
      setWeek((prev) => (weeks.includes(prev) ? prev : weeks[weeks.length - 1]));
    }
    setSlateSalaries(null);
    setImportStats(null);
    setSlateMeta(null);
  };

  const busy = loading || parentLoading || loadingSlates || loadingSalaries;
  const posTabs = isDfs ? ["ALL", "QB", "RB", "WR", "TE", "DST"] : ["ALL", "QB", "RB", "WR", "TE"];
  const showSetup = !mobileLayout || mobileStep === "setup";
  const showPool = !mobileLayout || mobileStep === "pool";
  const showResult = !mobileLayout || mobileStep === "result";

  const clearLocks = () => {
    setLocked(new Set());
    setExcluded(new Set());
  };

  return (
    <div className={`lineup-layout${mobileLayout ? " lineup-layout--mobile" : ""}`}>
      <section className="panel wide lineup-panel">
        {mobileLayout && (
          <MobileSubnav
            className="lineup-mobile-steps"
            tabs={[
              { id: "setup", label: "Setup" },
              { id: "pool", label: "Pool" },
              { id: "result", label: "Result" },
            ]}
            active={mobileStep}
            onChange={setMobileStep}
            ariaLabel="Lineup builder"
          />
        )}
        <div className={`lineup-header${showSetup ? "" : " lineup-mobile-pane-hidden"}`}>
          <div>
            <h2>DFS lineup builder</h2>
            <p className="chart-note">
              {isDfs
                ? `Build a ${siteConfig.label} lineup under the salary cap.`
                : "Best-effort PPR lineup from weekly projections."}
            </p>
            <p className="chart-note product-disclaimer">{PRODUCT_DISCLAIMER}</p>
          </div>
          <div className="lineup-controls">
            {activeMeta && season != null && (
              <div className="time-controls">
                <label className="control-label">
                  Season
                  <select
                    className="control-select"
                    value={season}
                    onChange={(e) => handleSeasonChange(e.target.value)}
                  >
                    {(activeMeta.seasons || []).map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </label>
                <label className="control-label">
                  Week
                  <select
                    className="control-select"
                    value={week ?? ""}
                    onChange={(e) => {
                      setWeek(Number(e.target.value));
                      setSlateSalaries(null);
                      setImportStats(null);
                      setSlateMeta(null);
                    }}
                  >
                    {weekOptions.map((w) => (
                      <option key={w} value={w}>{w}</option>
                    ))}
                  </select>
                </label>
              </div>
            )}
            <label className="control-label">
              Format
              <select
                className="control-select"
                value={site}
                onChange={(e) => setSite(e.target.value)}
              >
                {Object.entries(formats).map(([id, cfg]) => (
                  <option key={id} value={id}>{cfg.label || id}</option>
                ))}
              </select>
            </label>
            {isDfs && (
              <>
                <label className="control-label">
                  Slate type
                  <select
                    className="control-select"
                    value={slateCategory}
                    onChange={(e) => setSlateCategory(e.target.value)}
                  >
                    <option value="main">Main</option>
                    <option value="primetime">Primetime</option>
                    <option value="showdown">Showdown</option>
                    <option value="all">All</option>
                  </select>
                </label>
                <label className="control-label">
                  Slate
                  <select
                    className="control-select"
                    value={selectedSlateId}
                    onChange={(e) => {
                      const next = e.target.value;
                      setSelectedSlateId(next);
                      if (next) loadSalaries(next);
                    }}
                    disabled={loadingSlates || !slates.length}
                  >
                    {!slates.length && <option value="">No slates found</option>}
                    {slates.map((s) => (
                      <option key={s.slate_id} value={s.slate_id}>
                        {s.name || s.slate_id}
                        {s.player_count ? ` (${s.player_count})` : ""}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            {isDfs && (
              <label className="control-label">
                Salary cap
                <input
                  type="number"
                  className="control-input lineup-cap-input"
                  value={salaryCap}
                  onChange={(e) => setSalaryCap(e.target.value)}
                  min={1000}
                  step={100}
                />
              </label>
            )}
            <label className="control-label">
              Goal
              <select
                className="control-select"
                value={objective}
                onChange={(e) => setObjective(e.target.value)}
              >
                {objectiveOptions.map((o) => (
                  <option key={o.id} value={o.id} title={o.hint}>{o.label}</option>
                ))}
              </select>
            </label>
            {isDfs && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="lineup-file-input"
                  onChange={handleSalaryImport}
                  aria-hidden
                  tabIndex={-1}
                />
                <button
                  type="button"
                  className="btn"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={importing || busy}
                >
                  {importing ? "Importing…" : "Import CSV fallback"}
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => loadSalaries(selectedSlateId, { forceRefresh: true })}
                  disabled={loadingSalaries || !selectedSlateId || busy}
                >
                  {loadingSalaries ? "Loading…" : "Refresh slate"}
                </button>
              </>
            )}
            <label className="control-label lineup-check">
              <input
                type="checkbox"
                checked={requireQbStack}
                onChange={(e) => setRequireQbStack(e.target.checked)}
              />
              QB stack
            </label>
            <label className="control-label lineup-check">
              <input
                type="checkbox"
                checked={blockByeWeeks}
                onChange={(e) => setBlockByeWeeks(e.target.checked)}
              />
              Block byes
            </label>
            <label className="control-label">
              Lineups
              <select
                className="control-select"
                value={lineupCount}
                onChange={(e) => setLineupCount(Number(e.target.value))}
              >
                {[1, 2, 3, 5, 10].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
            {lineupCount > 1 && (
              <label className="control-label">
                Max overlap
                <input
                  type="number"
                  className="control-input lineup-cap-input"
                  min={0}
                  max={8}
                  value={maxOverlap}
                  onChange={(e) => setMaxOverlap(Number(e.target.value))}
                />
              </label>
            )}
            <button
              type="button"
              className={`btn primary lineup-optimize-btn${mobileLayout ? " lineup-optimize-btn--desktop" : ""}`}
              onClick={runOptimize}
              disabled={optimizing || busy || !pool.length}
            >
              {optimizing ? "Optimizing…" : "Optimize lineup"}
            </button>
          </div>
        </div>

        {error && <div className="error lineup-error">{error}</div>}

        {!isLiveContext && activeMeta && (
          <div className="info-callout" role="status">
            Injury boosts only on live week {activeMeta.default_week}.
          </div>
        )}

        {poolMeta?.bye_teams?.length > 0 && blockByeWeeks && (
          <div className="info-callout" role="status">
            Bye week blocked: {poolMeta.bye_teams.join(", ")}
          </div>
        )}

        {isDfs && (
          <div className="lineup-dfs-hint panel-inset">
            <strong>{siteConfig.label}</strong> — {rosterHint(site, formats)}.
            {importStats ? (
              <span>
                {" "}Slate loaded: {importStats.matched} matched
                {importStats.dst_added ? ` · ${importStats.dst_added} DST` : ""}
                {importStats.pool_without_salary
                  ? ` · ${importStats.pool_without_salary} pool players without salary`
                  : ""}
                {slateMeta?.offseason_placeholder ? " · offseason/test slate" : ""}
              </span>
            ) : loadingSalaries ? (
              <span> Loading live salaries…</span>
            ) : (
              <span> Pick a slate or import CSV.</span>
            )}
          </div>
        )}

        <div className={`lineup-grid${showPool ? "" : " lineup-mobile-pane-hidden"}`}>
          <div className="lineup-pool">
            <div className="lineup-pool-toolbar">
              <input
                type="search"
                className="search-input"
                placeholder="Search pool…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search player pool"
              />
              <div className="lineup-pos-tabs">
                {posTabs.map((p) => (
                  <button
                    key={p}
                    type="button"
                    className={`tab lineup-pos-tab ${posFilter === p ? "active" : ""}`}
                    onClick={() => setPosFilter(p)}
                  >
                    {p}
                  </button>
                ))}
              </div>
              <span className="table-meta">
                {filteredPool.length} players
                {poolMeta ? ` · ${poolMeta.season} Wk ${poolMeta.week}` : ""}
              </span>
            </div>
            {poolNote && <p className="chart-note lineup-pool-note">{poolNote}</p>}
            {mobileLayout ? (
              <MobileDataList
                loading={busy && filteredPool.length === 0}
                emptyMessage={!busy && filteredPool.length === 0 ? "No players in pool for this week." : null}
              >
                {filteredPool.map((row) => {
                  const pid = String(row.player_id || "");
                  const out = isPlayerUnavailable(row["Injury Status"]);
                  return (
                    <MobilePlayerCard
                      key={pid}
                      className={out ? "lineup-row-out" : ""}
                      unavailable={out}
                      name={row.Player}
                      meta={[row.Position, row.Team].filter(Boolean).join(" · ") || "—"}
                      heroValue={fmtNum(row["Projected Points"])}
                      heroLabel="proj"
                      badge={(
                        <>
                          {out && <span className="badge badge-out lineup-out-badge">OUT</span>}
                          {row.on_bye && <span className="badge badge-doubtful lineup-out-badge">BYE</span>}
                        </>
                      )}
                      expanded={(
                        <div className="mobile-stat-grid">
                          {isDfs && <MobileStat label="Salary" value={formatSalary(row.salary)} />}
                          {isDfs && <MobileStat label="Value" value={fmtNum(row.value)} />}
                          <MobileStat label="Floor" value={fmtNum(row["Low (P10)"])} />
                          <MobileStat label="Ceil" value={fmtNum(row["High (P90)"])} />
                        </div>
                      )}
                      actions={[
                        <label key="lock" className="lineup-mobile-check">
                          <input
                            type="checkbox"
                            checked={locked.has(pid)}
                            onChange={() => toggleLock(pid)}
                          />
                          Lock
                        </label>,
                        <label key="skip" className="lineup-mobile-check">
                          <input
                            type="checkbox"
                            checked={excluded.has(pid)}
                            onChange={() => toggleExclude(pid)}
                          />
                          Skip
                        </label>,
                      ]}
                    />
                  );
                })}
              </MobileDataList>
            ) : (
            <div className="table-wrap lineup-pool-table">
              <table>
                <thead>
                  <tr>
                    <th>Lock</th>
                    <th>Skip</th>
                    <th>Player</th>
                    <th>Pos</th>
                    <th>Team</th>
                    {isDfs && <th className="num">Salary</th>}
                    <th className="num">Proj</th>
                    {isDfs && <th className="num">Value</th>}
                    <th className="num">Floor</th>
                    <th className="num">Ceil</th>
                  </tr>
                </thead>
                <tbody>
                  {busy && filteredPool.length === 0 && (
                    <tr>
                      <td colSpan={isDfs ? 10 : 8} className="table-empty-state muted">
                        Loading player pool…
                      </td>
                    </tr>
                  )}
                  {!busy && filteredPool.length === 0 && (
                    <tr>
                      <td colSpan={isDfs ? 10 : 8} className="table-empty-state muted">
                        No players in pool for this week.
                      </td>
                    </tr>
                  )}
                  {filteredPool.map((row) => {
                    const pid = String(row.player_id || "");
                    const out = isPlayerUnavailable(row["Injury Status"]);
                    return (
                      <tr key={pid} className={out ? "lineup-row-out" : ""}>
                        <td>
                          <input
                            type="checkbox"
                            checked={locked.has(pid)}
                            onChange={() => toggleLock(pid)}
                            aria-label={`Lock ${row.Player}`}
                          />
                        </td>
                        <td>
                          <input
                            type="checkbox"
                            checked={excluded.has(pid)}
                            onChange={() => toggleExclude(pid)}
                            aria-label={`Exclude ${row.Player}`}
                          />
                        </td>
                        <td>
                          <PlayerCell
                            name={row.Player}
                            team={row.Team}
                            playerId={pid}
                            media={playerMedia}
                            size="sm"
                            showTeam={false}
                            narrativeScope="weekly"
                          />
                          {out && <span className="badge badge-out lineup-out-badge">OUT</span>}
                          {row.on_bye && <span className="badge badge-doubtful lineup-out-badge">BYE</span>}
                        </td>
                        <td>{row.Position}</td>
                        <td>{row.Team || "—"}</td>
                        {isDfs && <td className="num">{formatSalary(row.salary)}</td>}
                        <td className="num">{fmtNum(row["Projected Points"])}</td>
                        {isDfs && <td className="num muted">{fmtNum(row.value)}</td>}
                        <td className="num muted">{fmtNum(row["Low (P10)"])}</td>
                        <td className="num muted">{fmtNum(row["High (P90)"])}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            )}
          </div>

          <div className={`lineup-result${showResult ? "" : " lineup-mobile-pane-hidden"}`} ref={resultRef}>
            <h3 className="lineup-result-title">
              {lineups.length > 1 ? `Optimal lineups (${lineups.length})` : "Optimal lineup"}
            </h3>
            <p className="lineup-format-hint">{rosterHint(site, formats)}</p>
            {totalPoints != null && (
              <p className="lineup-total">
                Total {objectiveOptions.find((o) => o.id === objective)?.label || "Proj"}:{" "}
                <strong>{fmtNum(totalPoints)}</strong>
                {totalSalary != null && (
                  <>
                    {" · "}
                    <span className="lineup-salary-total">
                      {formatSalary(totalSalary)}
                      {salaryRemaining != null && (
                        <span className="muted"> ({formatSalary(salaryRemaining)} left)</span>
                      )}
                    </span>
                  </>
                )}
              </p>
            )}
            {lineups.length > 1 && (
              <div className="lineup-multi-tabs">
                {lineups.map((entry, idx) => (
                  <button
                    key={idx}
                    type="button"
                    className={`tab lineup-pos-tab ${activeLineupIdx === idx ? "active" : ""}`}
                    onClick={() => {
                      setActiveLineupIdx(idx);
                      setLineup(entry.lineup || []);
                      setTotalPoints(entry.total_points);
                      setTotalSalary(entry.total_salary);
                      setSalaryRemaining(entry.salary_remaining);
                    }}
                  >
                    #{idx + 1} · {fmtNum(entry.total_points)}
                  </button>
                ))}
              </div>
            )}
            {mobileLayout ? (
              <MobileDataList
                emptyMessage={
                  lineup.length === 0
                    ? (optimizing
                      ? "Running optimizer…"
                      : isDfs
                        ? "Load salaries or lock/exclude players, then optimize."
                        : "Lock/exclude players, then click Optimize lineup.")
                    : null
                }
              >
                {lineup.map((row) => (
                  <MobilePlayerCard
                    key={`${row.slot}-${row.player_id}`}
                    name={row.player}
                    meta={`${row.slot} · ${row.position}`}
                    heroValue={fmtNum(row.proj)}
                    heroLabel="proj"
                    expanded={(
                      <div className="mobile-stat-grid">
                        {isDfs && <MobileStat label="Salary" value={formatSalary(row.salary)} />}
                        <MobileStat label="Floor" value={fmtNum(row.floor)} />
                        <MobileStat label="Ceil" value={fmtNum(row.ceiling)} />
                      </div>
                    )}
                  />
                ))}
              </MobileDataList>
            ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Slot</th>
                    <th>Player</th>
                    <th>Pos</th>
                    {isDfs && <th className="num">Salary</th>}
                    <th className="num">Proj</th>
                    <th className="num">Floor</th>
                    <th className="num">Ceil</th>
                  </tr>
                </thead>
                <tbody>
                  {lineup.length === 0 && (
                    <tr>
                      <td colSpan={isDfs ? 7 : 6} className="table-empty-state muted">
                        {optimizing
                          ? "Running optimizer…"
                          : isDfs
                            ? "Load salaries or lock/exclude players, then optimize."
                            : "Lock/exclude players, then click Optimize lineup."}
                      </td>
                    </tr>
                  )}
                  {lineup.map((row) => (
                    <tr key={`${row.slot}-${row.player_id}`}>
                      <td><span className="lineup-slot-badge">{row.slot}</span></td>
                      <td>
                        <PlayerCell
                          name={row.player}
                          team={row.team}
                          playerId={row.player_id}
                          media={playerMedia}
                          size="sm"
                          showTeam={false}
                          narrativeScope="weekly"
                        />
                      </td>
                      <td>{row.position}</td>
                      {isDfs && <td className="num">{formatSalary(row.salary)}</td>}
                      <td className="num">{fmtNum(row.proj)}</td>
                      <td className="num muted">{fmtNum(row.floor)}</td>
                      <td className="num muted">{fmtNum(row.ceiling)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            )}
            {optimizeNote && <p className="chart-note lineup-result-note">{optimizeNote}</p>}
          </div>
        </div>

        {mobileLayout && (mobileStep === "pool" || mobileStep === "setup") && (
          <div className="lineup-mobile-sticky-bar">
            <span className="lineup-mobile-sticky-meta">
              {locked.size} locked · {excluded.size} excluded
            </span>
            <button type="button" className="btn-ghost btn-sm" onClick={clearLocks} disabled={!locked.size && !excluded.size}>
              Clear
            </button>
            <button
              type="button"
              className="btn primary"
              onClick={runOptimize}
              disabled={optimizing || busy || !pool.length}
            >
              {optimizing ? "Optimizing…" : "Optimize"}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
