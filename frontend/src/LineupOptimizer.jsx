import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch, PRODUCT_DISCLAIMER } from "./auth";
import { connectionErrorMessage, fmtNum, isPlayerUnavailable, parseApiError } from "./format";
import useMobileLayout from "./useMobileLayout";
import MobileSubnav from "./layout/MobileSubnav";
import MobileDataList, { MobileStat } from "./MobileDataList";
import MobilePlayerCard from "./MobilePlayerCard";
import PlayerCell, { usePlayerMedia } from "./PlayerCell";
import Button from "./ui/Button";
import ThinkingScrim from "./ui/ThinkingScrim";
import useSlowThink from "./hooks/useSlowThink";
import {
  HubAlert,
  HubAlertStack,
  HubFilterChip,
  HubPage,
} from "./DraftHub/HubUILayout";
import {
  DEFAULT_FORMATS,
  LINEUP_COUNTS,
  SLATE_CATEGORIES,
  capMeterTone,
  dfsHeroCopy,
  dfsHeroNote,
  dfsStatusChip,
  dfsSummaryItems,
  emptyLineupCopy,
  filterObjectives,
  formatPersonality,
  formatSalary,
  launchCopy,
  lockedSalaryTotal,
  optimizeButtonLabel,
  rosterHint,
  salarySpend,
  slateLoadCopy,
} from "./dfsToolPresentation";

function DfsPinRow({ playerId, locked, excluded, onLock, onSkip }) {
  return (
    <div className="dfs-pin-row">
      <button
        type="button"
        className={`dfs-pin${locked ? " is-lock" : ""}`}
        aria-pressed={locked}
        onClick={() => onLock(playerId)}
      >
        Lock
      </button>
      <button
        type="button"
        className={`dfs-pin${excluded ? " is-skip" : ""}`}
        aria-pressed={excluded}
        onClick={() => onSkip(playerId)}
      >
        Skip
      </button>
    </div>
  );
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
  const showThink = useSlowThink(optimizing || loadingSalaries);

  const weekOptions = useMemo(() => {
    if (!activeMeta || season == null) return [];
    return activeMeta.weeks_by_season?.[String(season)] || [];
  }, [activeMeta, season]);

  const isLiveContext = useMemo(() => {
    if (!activeMeta || season == null || week == null) return false;
    return season === activeMeta.default_season && week === activeMeta.default_week;
  }, [activeMeta, season, week]);

  const objectiveOptions = useMemo(() => filterObjectives(isDfs), [isDfs]);

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
    setSlateSalaries(null);
    setImportStats(null);
    setSlates([]);
    setSelectedSlateId("");
    setSlateMeta(null);
  }, [site, siteConfig.salary_cap]);

  useEffect(() => {
    if (site === "seasonal" && objective === "value") setObjective("median");
  }, [site, objective]);

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

  const selectedSlate = slates.find((s) => String(s.slate_id) === String(selectedSlateId));
  const hero = dfsHeroCopy({ isDfs, siteLabel: siteConfig.label });
  const heroNote = dfsHeroNote({ isDfs });
  const statusChip = dfsStatusChip({
    isDfs,
    loadingSalaries,
    importStats,
    slateMeta,
    poolCount: pool.length,
  });
  const previewSalary = lineup.length
    ? Number(totalSalary)
    : lockedSalaryTotal(pool, locked);
  const spend = salarySpend({
    totalSalary: previewSalary,
    salaryCap,
    salaryRemaining: lineup.length ? salaryRemaining : undefined,
  });
  const meterTone = capMeterTone({ remaining: spend.remaining, cap: spend.cap });
  const summaryItems = dfsSummaryItems({
    siteLabel: siteConfig.label,
    season,
    week,
    slateName: selectedSlate?.name || slateMeta?.name,
    isDfs,
    salaryCap,
    lockedCount: locked.size,
    excludedCount: excluded.size,
    objectiveId: objective,
    lineupCount,
  });
  const launch = launchCopy({ isDfs, hasLineup: lineup.length > 0, siteLabel: siteConfig.label });
  const canOptimize = !optimizing && !busy && pool.length > 0 && !(isDfs && !slateSalaries?.length);
  const optimizeLabel = optimizeButtonLabel({ optimizing, lineupCount });

  return (
    <HubPage className={`dfs-tool lineup-layout${mobileLayout ? " lineup-layout--mobile" : ""}`}>
      <ThinkingScrim
        show={showThink}
        scene="dfs"
        title={optimizing ? "Building the lineup" : undefined}
        steps={optimizing
          ? ["Reading the pool", "Respecting locks and the cap", "Filling every slot"]
          : undefined}
      />
      {mobileLayout && (
        <MobileSubnav
          className="lineup-mobile-steps"
          tabs={[
            { id: "setup", label: "Setup" },
            { id: "pool", label: "Pool" },
            { id: "result", label: "Lineup" },
          ]}
          active={mobileStep}
          onChange={setMobileStep}
          ariaLabel="Lineup builder"
        />
      )}

      <header className={`mock-draft-hero dfs-hero${showSetup ? "" : " lineup-mobile-pane-hidden"}`}>
        <div>
          <p className="hub-experience-kicker">{hero.eyebrow}</p>
          <h2>{hero.heading}</h2>
          <p>{hero.support}</p>
        </div>
        <div className="mock-draft-hero-note" role="note">
          <strong>{heroNote.title}</strong>
          <span>{heroNote.body}</span>
          <span className={`hub-experience-chip${statusChip.tone === "readonly" ? " is-readonly" : ""}`}>
            {statusChip.label}
          </span>
        </div>
      </header>

      {(error || (!isLiveContext && activeMeta) || (poolMeta?.bye_teams?.length > 0 && blockByeWeeks)) && (
        <HubAlertStack>
          {error ? <HubAlert variant="danger">{error}</HubAlert> : null}
          {!isLiveContext && activeMeta ? (
            <HubAlert variant="info">
              Opportunity adjustments only apply on the live week ({activeMeta.default_week}).
            </HubAlert>
          ) : null}
          {poolMeta?.bye_teams?.length > 0 && blockByeWeeks ? (
            <HubAlert variant="info">
              Bye week blocked: {poolMeta.bye_teams.join(", ")}
            </HubAlert>
          ) : null}
        </HubAlertStack>
      )}

      <div className="mock-draft-builder dfs-builder">
        <div className="mock-draft-config dfs-config">
          <section
            className={`mock-draft-step${showSetup ? "" : " lineup-mobile-pane-hidden"}`}
            aria-labelledby="dfs-format-title"
          >
            <header className="mock-draft-step-head">
              <span>1</span>
              <div>
                <h3 id="dfs-format-title">Choose the format</h3>
                <p>Three formats, three different kinds of pressure.</p>
              </div>
            </header>
            <div className="mock-draft-formats" aria-label="Lineup format">
              {Object.entries(formats).map(([id]) => {
                const personality = formatPersonality(id, formats);
                const active = site === id;
                return (
                  <button
                    key={id}
                    type="button"
                    className={`mock-draft-format-card${active ? " is-active" : ""}`}
                    disabled={busy || optimizing}
                    aria-pressed={active}
                    onClick={() => setSite(id)}
                  >
                    <span className="mock-draft-format-icon" aria-hidden="true">{personality.icon}</span>
                    <span>
                      <strong>{personality.label}</strong>
                      <small>{personality.note}</small>
                    </span>
                    <span className="mock-draft-format-check" aria-hidden="true">{active ? "✓" : ""}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <section
            className={`mock-draft-step${showSetup ? "" : " lineup-mobile-pane-hidden"}`}
            aria-labelledby="dfs-week-title"
          >
            <header className="mock-draft-step-head">
              <span>2</span>
              <div>
                <h3 id="dfs-week-title">Set the week</h3>
                <p>{isDfs ? "Salaries follow the slate you pick." : "Projections follow the week you pick."}</p>
              </div>
            </header>
            {activeMeta && season != null && (
              <div className="dfs-field-row">
                <label className="control-label" htmlFor="dfs-season">
                  Season
                  <select
                    id="dfs-season"
                    className="control-select"
                    value={season}
                    onChange={(e) => handleSeasonChange(e.target.value)}
                  >
                    {(activeMeta.seasons || []).map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </label>
                <label className="control-label" htmlFor="dfs-week">
                  Week
                  <select
                    id="dfs-week"
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
                {isDfs && (
                  <label className="control-label" htmlFor="dfs-cap">
                    Salary cap
                    <span className="dfs-currency">
                      <span aria-hidden="true">$</span>
                      <input
                        id="dfs-cap"
                        type="number"
                        className="control-input lineup-cap-input"
                        value={salaryCap}
                        onChange={(e) => setSalaryCap(e.target.value)}
                        min={1000}
                        step={100}
                      />
                    </span>
                  </label>
                )}
              </div>
            )}
            {isDfs && (
              <>
                <div className="mock-draft-team-chips dfs-slate-chips" role="group" aria-label="Slate type">
                  {SLATE_CATEGORIES.map((cat) => (
                    <HubFilterChip
                      key={cat.id}
                      compact
                      active={slateCategory === cat.id}
                      disabled={busy}
                      title={cat.hint}
                      onClick={() => setSlateCategory(cat.id)}
                    >
                      {cat.label}
                    </HubFilterChip>
                  ))}
                </div>
                <label className="control-label dfs-slate-select" htmlFor="dfs-slate">
                  Slate
                  <select
                    id="dfs-slate"
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
                <p className="chart-note dfs-slate-note">
                  {slateLoadCopy({
                    site,
                    formats,
                    importStats,
                    loadingSalaries,
                    slateMeta,
                  })}
                </p>
              </>
            )}
          </section>

          <section
            className={`mock-draft-step${showSetup ? "" : " lineup-mobile-pane-hidden"}`}
            aria-labelledby="dfs-goal-title"
          >
            <header className="mock-draft-step-head">
              <span>3</span>
              <div>
                <h3 id="dfs-goal-title">Pick the goal</h3>
                <p>Choose the score the optimizer should chase.</p>
              </div>
            </header>
            <div
              className={`mock-draft-experience-toggle dfs-goal-toggle${isDfs ? " is-dfs" : ""}`}
              role="group"
              aria-label="Optimization goal"
            >
              {objectiveOptions.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className={objective === opt.id ? "is-active" : ""}
                  aria-pressed={objective === opt.id}
                  onClick={() => setObjective(opt.id)}
                >
                  {opt.shortLabel}
                  <small>{opt.hint}</small>
                </button>
              ))}
            </div>
            <div className="dfs-policy">
              <label className="hub-toggle-row">
                <input
                  type="checkbox"
                  checked={requireQbStack}
                  onChange={(e) => setRequireQbStack(e.target.checked)}
                />
                <span>
                  Require a QB stack
                  <span className="hub-toggle-hint">
                    Pair the quarterback with at least one pass-catcher from the same team.
                  </span>
                </span>
              </label>
              <label className="hub-toggle-row">
                <input
                  type="checkbox"
                  checked={blockByeWeeks}
                  onChange={(e) => setBlockByeWeeks(e.target.checked)}
                />
                <span>
                  Block bye weeks
                  <span className="hub-toggle-hint">
                    Sit players whose NFL team is off this week.
                  </span>
                </span>
              </label>
            </div>
            <details className="mock-draft-advanced">
              <summary>Advanced construction <span>Optional</span></summary>
              <div className="mock-draft-advanced-body">
                <div className="dfs-field-row">
                  <div>
                    <span className="hub-filter-label">Lineups</span>
                    <div className="mock-draft-team-chips" role="group" aria-label="Lineup count">
                      {LINEUP_COUNTS.map((n) => (
                        <HubFilterChip
                          key={n}
                          compact
                          active={lineupCount === n}
                          onClick={() => setLineupCount(n)}
                        >
                          {n}
                        </HubFilterChip>
                      ))}
                    </div>
                  </div>
                  {lineupCount > 1 && (
                    <label className="control-label" htmlFor="dfs-overlap">
                      Max overlap
                      <input
                        id="dfs-overlap"
                        type="number"
                        className="control-input lineup-cap-input"
                        min={0}
                        max={8}
                        value={maxOverlap}
                        onChange={(e) => setMaxOverlap(Number(e.target.value))}
                        aria-describedby="dfs-overlap-hint"
                      />
                    </label>
                  )}
                </div>
                {lineupCount > 1 && (
                  <p id="dfs-overlap-hint" className="chart-note">
                    Later lineups can share at most this many players with an earlier one.
                  </p>
                )}
                {isDfs && (
                  <div className="dfs-advanced-actions">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".csv,text/csv"
                      className="lineup-file-input"
                      onChange={handleSalaryImport}
                      aria-hidden
                      tabIndex={-1}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={importing || busy}
                    >
                      {importing ? "Importing…" : "Import CSV fallback"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => loadSalaries(selectedSlateId, { forceRefresh: true })}
                      disabled={loadingSalaries || !selectedSlateId || busy}
                    >
                      {loadingSalaries ? "Loading…" : "Refresh slate"}
                    </Button>
                  </div>
                )}
              </div>
            </details>
          </section>

          <section
            className={`dfs-pool-section${showPool ? "" : " lineup-mobile-pane-hidden"}`}
            aria-labelledby="dfs-pool-title"
          >
            <header className="mock-draft-step-head">
              <span>4</span>
              <div>
                <h3 id="dfs-pool-title">Shape the pool</h3>
                <p>Lock the players you want. Skip the ones you do not.</p>
              </div>
            </header>
            <div className="lineup-pool-toolbar">
              <input
                type="search"
                className="search-input"
                placeholder="Search pool…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search player pool"
              />
              <div className="lineup-pos-tabs" role="group" aria-label="Position filter">
                {posTabs.map((p) => (
                  <HubFilterChip
                    key={p}
                    compact
                    active={posFilter === p}
                    onClick={() => setPosFilter(p)}
                  >
                    {p}
                  </HubFilterChip>
                ))}
              </div>
              <span className="table-meta">
                {filteredPool.length} players
                {poolMeta ? ` · ${poolMeta.season} Wk ${poolMeta.week}` : ""}
                {locked.size || excluded.size ? ` · ${locked.size} locked · ${excluded.size} skipped` : ""}
              </span>
              {(locked.size > 0 || excluded.size > 0) && (
                <Button variant="ghost" size="sm" onClick={clearLocks}>
                  Clear pins
                </Button>
              )}
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
                        <button
                          key="lock"
                          type="button"
                          className={`dfs-pin${locked.has(pid) ? " is-lock" : ""}`}
                          aria-pressed={locked.has(pid)}
                          onClick={() => toggleLock(pid)}
                        >
                          Lock
                        </button>,
                        <button
                          key="skip"
                          type="button"
                          className={`dfs-pin${excluded.has(pid) ? " is-skip" : ""}`}
                          aria-pressed={excluded.has(pid)}
                          onClick={() => toggleExclude(pid)}
                        >
                          Skip
                        </button>,
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
                      <th>Pin</th>
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
                        <td colSpan={isDfs ? 9 : 7} className="table-empty-state muted">
                          Loading player pool…
                        </td>
                      </tr>
                    )}
                    {!busy && filteredPool.length === 0 && (
                      <tr>
                        <td colSpan={isDfs ? 9 : 7} className="table-empty-state muted">
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
                            <DfsPinRow
                              playerId={pid}
                              locked={locked.has(pid)}
                              excluded={excluded.has(pid)}
                              onLock={toggleLock}
                              onSkip={toggleExclude}
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
          </section>
        </div>

        <aside
          className={`mock-draft-launchpad dfs-launchpad${showResult ? "" : " lineup-mobile-pane-hidden"}`}
          aria-label="Lineup summary"
          ref={resultRef}
        >
          <p className="hub-experience-kicker">Your lineup</p>
          <div className="dfs-launch-copy">
            <h3>{launch.title}</h3>
            <p>{launch.body}</p>
          </div>

          {isDfs && spend.cap != null && (
            <div className={`dfs-cap-meter dfs-cap-meter--${meterTone}`} aria-label="Salary used">
              <div className="dfs-cap-meter-top">
                <span>{lineup.length ? "Salary used" : "Locked salary"}</span>
                <strong>
                  {formatSalary(spend.used)}
                  <span className="muted"> / {formatSalary(spend.cap)}</span>
                </strong>
              </div>
              <div className="dfs-cap-meter-track">
                <span style={{ width: `${spend.pct}%` }} />
              </div>
              <p className="dfs-cap-meter-foot">
                {spend.over
                  ? `${formatSalary(Math.abs(spend.remaining))} over the cap`
                  : `${formatSalary(spend.remaining)} left`}
              </p>
            </div>
          )}

          <dl className="dfs-summary-list">
            {summaryItems.map((item) => (
              <div key={item.id}>
                <dt>{item.label}</dt>
                <dd>{item.value}</dd>
              </div>
            ))}
          </dl>

          {totalPoints != null && (
            <p className="dfs-total">
              {objectiveOptions.find((o) => o.id === objective)?.label || "Proj"}{" "}
              <strong>{fmtNum(totalPoints)}</strong>
            </p>
          )}

          {lineups.length > 1 && (
            <div className="lineup-multi-tabs" role="tablist" aria-label="Generated lineups">
              {lineups.map((entry, idx) => (
                <button
                  key={idx}
                  type="button"
                  role="tab"
                  aria-selected={activeLineupIdx === idx}
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

          {mobileLayout && lineup.length > 0 ? (
            <MobileDataList>
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
            <ol className="dfs-slot-list">
              {lineup.length === 0 && (
                <li className="dfs-slot-empty">
                  {error || emptyLineupCopy({ optimizing, isDfs })}
                </li>
              )}
              {lineup.map((row) => (
                <li key={`${row.slot}-${row.player_id}`} className="dfs-slot-row">
                  <span className="lineup-slot-badge">{row.slot}</span>
                  <PlayerCell
                    name={row.player}
                    team={row.team}
                    playerId={row.player_id}
                    media={playerMedia}
                    size="sm"
                    showTeam={false}
                    narrativeScope="weekly"
                  />
                  <span className="dfs-slot-stats">
                    {isDfs && <span>{formatSalary(row.salary)}</span>}
                    <strong>{fmtNum(row.proj)}</strong>
                  </span>
                </li>
              ))}
            </ol>
          )}
          {optimizeNote && <p className="chart-note lineup-result-note">{optimizeNote}</p>}
          {error ? (
            <p className="dfs-launch-error" role="alert">{error}</p>
          ) : null}

          <Button
            className="mock-draft-launch-button"
            disabled={!canOptimize}
            onClick={runOptimize}
          >
            {optimizeLabel}
          </Button>
          <p className="mock-draft-launch-foot">
            {rosterHint(site, formats)}
          </p>
          <p className="sr-only">{PRODUCT_DISCLAIMER}</p>
        </aside>
      </div>

      {mobileLayout && (mobileStep === "pool" || mobileStep === "setup") && (
        <div className="lineup-mobile-sticky-bar">
          <span className="lineup-mobile-sticky-meta">
            {locked.size} locked · {excluded.size} skipped
          </span>
          <button type="button" className="btn-ghost btn-sm" onClick={clearLocks} disabled={!locked.size && !excluded.size}>
            Clear
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={runOptimize}
            disabled={!canOptimize}
          >
            {optimizing ? "Optimizing…" : "Build"}
          </button>
        </div>
      )}
    </HubPage>
  );
}
