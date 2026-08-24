import React, { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../auth";
import { parseApiError } from "../format";
import HoverTip, { TipLine, TipTitle } from "../HoverTip";
import { TableSkeletonBody } from "../TableSkeleton";
import useMobileLayout from "../useMobileLayout";
import MobileDataList, { MobileStat } from "../MobileDataList";
import MobilePlayerCard from "../MobilePlayerCard";
import { usePlayerMedia } from "../PlayerCell";
import { confirmDialog } from "../ui/confirm";
import HubTabIntro from "./HubTabIntro";
import { pinNeedPositions } from "./draftRoomHelpers";
import {
  filterAndSortRows,
  fmtSal,
  formatStatusLabel,
  nextSortState,
} from "./valueSheetUtils";
import { HubPage, HubTableCard, HubFilterMenu, HubFilterChip, SortTh } from "./HubUILayout";
import { HUB_POSITION_FILTERS, normalizeHubPosition } from "./hubPositions";
import ValueSheetPlayerRow from "./ValueSheetPlayerRow";
import {
  formatSeasonPts,
  isScheduleAwareMethod,
  resolveSeasonBand,
  seasonMethodShortLabel,
  seasonRangeTooltip,
} from "../seasonQuantiles";
import {
  effectiveAuctionBid,
  formatRaavDelta,
  formatRiskScore,
  isRiskToleranceActive,
  raavDelta,
  riskScoreTooltip,
  riskToleranceLabel,
} from "../riskAdjustedValue";
import RaavBidCell from "./RaavBidCell";

const TIERS = ["ALL", "Elite", "Tier 1", "Tier 2", "Tier 3", "Depth"];
const POSITIONS = HUB_POSITION_FILTERS;
const AVAILABILITY_FILTERS = [
  { id: "ALL", label: "All" },
  { id: "AVAILABLE", label: "Available" },
  { id: "TAKEN", label: "Taken" },
  { id: "MINE", label: "Mine" },
  { id: "SLEEPER", label: "Targets" },
];
const RISK_PROFILE_FILTERS = [
  { id: "ALL", label: "All" },
  { id: "UPSIDE", label: "Ceiling" },
  { id: "FLOOR", label: "Floor" },
];
const SORT_MENU_OPTIONS = [
  { id: "fair_value", label: "Suggested bid" },
  { id: "risk_score", label: "Risk score" },
  { id: "season_proj", label: "Projected points" },
  { id: "season_spread", label: "Season spread" },
  { id: "upside_skew", label: "Upside skew" },
  { id: "value_delta", label: "Value vs cost" },
  { id: "player", label: "Name" },
];

/** SCORE-16: plain-language column + control copy. */
const VALUE_VS_COST_TIP = (
  <>
    <TipTitle>Value vs cost</TipTitle>
    <TipLine>
      Contract salary minus suggested bid. Negative means the player costs less than fair value.
    </TipLine>
  </>
);
const PROJECTED_POINTS_TIP = (
  <>
    <TipTitle>Projected points</TipTitle>
    <TipLine>
      Median season fantasy points with a floor–ceiling band. Use it to compare production before bidding.
    </TipLine>
  </>
);

export default function ValueSheetTable({
  rows,
  season,
  onAddToRoster,
  rosterIds,
  sleeper,
  mode = "all",
  title,
  subtitle,
  purpose,
  audience,
  compact = false,
  onSelectPlayer,
  onRowDoubleClick,
  selectedPlayerId,
  showAdd = true,
  showStatus = true,
  showDelta = true,
  showAdvancedColumns: showAdvancedProp,
  maxRows,
  loading = false,
  defaultPosFilter = "ALL",
  showTierFilters = true,
  hideHeader = false,
  hideIntro = false,
  narrativeScope = "weekly",
  isCommissioner = false,
  riskTolerance = 0,
  rules = null,
  needPositions = [],
  draftConsole = false,
  onQueuePlayer,
  onWatchPlayer,
  watchIds = [],
  canNominate = false,
  minBid = 1,
}) {
  const isAvailableView = mode === "available";
  const [sortKey, setSortKey] = useState("fair_value");
  const [sortDir, setSortDir] = useState("desc");
  const [posFilter, setPosFilter] = useState(defaultPosFilter);
  const [statusFilter, setStatusFilter] = useState(isAvailableView ? "AVAILABLE" : "ALL");
  const [tierFilter, setTierFilter] = useState("ALL");
  const [riskProfile, setRiskProfile] = useState("ALL");
  const [search, setSearch] = useState("");
  const [needsOnly, setNeedsOnly] = useState(false);
  const [addingId, setAddingId] = useState(null);
  const [addError, setAddError] = useState("");
  const [showAdvancedLocal, setShowAdvancedLocal] = useState(false);
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false);
  const [mobileListLimit, setMobileListLimit] = useState(80);

  const MOBILE_LIST_PAGE = 80;

  const showAdvanced = showAdvancedProp ?? (draftConsole ? false : compact ? true : showAdvancedLocal);
  const activeRisk = isRiskToleranceActive(riskTolerance);
  // Risk score column: Advanced always; also when RAAV stance is on so the badge has context.
  const showRiskScore = draftConsole ? true : (showAdvanced || activeRisk);
  const showPosCol = !draftConsole;
  const showValueRange = draftConsole;
  const showAdvancedToggle = !compact && showAdvancedProp == null;

  const sleeperLinked = Boolean(sleeper?.sleeper_league_id && sleeper?.sleeper_roster_id);
  const showSelect = Boolean(onSelectPlayer);
  const actionCol = showAdd || showSelect;
  // Core: Player, Pos, Projected pts, Bid, Tier (+ optional Status/Value/Action/Risk). Advanced adds Team/PG/Spread/Min/Max.
  const baseCols = (showPosCol ? 5 : 4)
    + (showValueRange ? 1 : 0)
    + (showAdvanced ? 5 : 0)
    + (showRiskScore ? 1 : 0)
    + (showDelta ? 1 : 0)
    + (showStatus ? 1 : 0)
    + (actionCol ? 1 : 0);
  const colCount = baseCols;

  useEffect(() => {
    setPosFilter(defaultPosFilter);
  }, [defaultPosFilter]);

  useEffect(() => {
    setMobileListLimit(MOBILE_LIST_PAGE);
  }, [posFilter, statusFilter, tierFilter, riskProfile, search, sortKey, sortDir, rows]);

  const sorted = useMemo(() => {
    let list = filterAndSortRows(rows, {
      pool: isAvailableView ? "available" : "all",
      posFilter,
      statusFilter: isAvailableView ? "ALL" : statusFilter,
      tierFilter,
      riskProfile,
      search,
      sortKey,
      sortDir,
    });
    const pins = [...new Set((needPositions || []).map((p) => String(p || "").toUpperCase()).filter(Boolean))];
    if (needsOnly && pins.length) {
      const pinSet = new Set(pins);
      list = list.filter((r) => pinSet.has(normalizeHubPosition(r.position)));
    }
    return pinNeedPositions(list, pins, maxRows);
  }, [rows, isAvailableView, posFilter, statusFilter, tierFilter, riskProfile, search, sortKey, sortDir, maxRows, needPositions, needsOnly]);

  const seasonScaleMax = useMemo(() => {
    let max = 0;
    for (const row of rows || []) {
      const band = resolveSeasonBand(row);
      if (band.p90 != null && band.p90 > max) max = band.p90;
    }
    return max > 0 ? max : 1;
  }, [rows]);

  const seasonMethod = useMemo(() => {
    for (const row of rows || []) {
      if (row?.season_quantile_method) return row.season_quantile_method;
    }
    return null;
  }, [rows]);

  const seasonMethodNote = useMemo(() => {
    if (!rows?.length) return null;
    const label = seasonMethodShortLabel(seasonMethod);
    if (isScheduleAwareMethod(seasonMethod)) {
      return { text: label, preliminary: false };
    }
    return { text: label || "preliminary season bands", preliminary: true };
  }, [rows, seasonMethod]);

  const seasonBandsTip = useMemo(() => {
    const tip = seasonRangeTooltip(seasonMethod, {
      preliminary: !isScheduleAwareMethod(seasonMethod),
    });
    return (
      <>
        <TipTitle>
          {seasonMethodNote?.preliminary ? "Preliminary season bands" : "Season range"}
        </TipTitle>
        <TipLine>{tip}</TipLine>
      </>
    );
  }, [seasonMethod, seasonMethodNote]);

  const projectedPointsTip = useMemo(() => {
    const bandTip = seasonRangeTooltip(seasonMethod, {
      preliminary: !isScheduleAwareMethod(seasonMethod),
    });
    return (
      <>
        {PROJECTED_POINTS_TIP}
        <TipLine>{bandTip}</TipLine>
      </>
    );
  }, [seasonMethod]);

  const secondaryFilterCount = useMemo(() => {
    let n = 0;
    if (showTierFilters && tierFilter !== "ALL") n += 1;
    if (!isAvailableView && statusFilter !== "ALL") n += 1;
    if (riskProfile !== "ALL") n += 1;
    if (showAdvancedToggle && showAdvancedLocal) n += 1;
    return n;
  }, [
    showTierFilters,
    tierFilter,
    isAvailableView,
    statusFilter,
    riskProfile,
    showAdvancedToggle,
    showAdvancedLocal,
  ]);

  const mobileRows = useMemo(
    () => (maxRows ? sorted : sorted.slice(0, mobileListLimit)),
    [sorted, maxRows, mobileListLimit],
  );

  const sheetPlayerIds = useMemo(
    () => sorted.map((r) => r.player_id).filter(Boolean),
    [sorted],
  );
  const playerMedia = usePlayerMedia(sheetPlayerIds);

  const totalAvailable = useMemo(
    () => filterAndSortRows(rows, { pool: "available" }).length,
    [rows],
  );

  const onSort = (col) => {
    const next = nextSortState(sortKey, sortDir, col);
    setSortKey(next.sortKey);
    setSortDir(next.sortDir);
  };

  const postAddPlayer = useCallback(async (row, { force = false } = {}) => {
    const sal = effectiveAuctionBid(row, riskTolerance, rules)
      ?? row.fair_value
      ?? row.model_bid_hint
      ?? row.min_sal
      ?? 1;
    const res = await apiFetch("/api/hub/roster", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        player_id: row.player_id,
        player_name: row.player,
        team: row.team,
        position: row.position,
        salary: sal,
        contract_years: 1,
        force,
      }),
    });
    if (!res.ok) throw new Error(await parseApiError(res));
  }, [riskTolerance, rules]);

  const addPlayer = useCallback(async (row) => {
    const taken = row.status === "taken";
    setAddError("");
    if (taken && !isCommissioner) {
      setAddError(`${row.player || "Player"} is already on another roster.`);
      return;
    }
    if (taken && isCommissioner) {
      const ok = await confirmDialog({
        title: "Player already taken",
        message:
          `${row.player || "This player"} is already on another team's roster. `
          + "Reassign them to your team? They will be removed from the other roster.",
        confirmLabel: "Reassign",
        danger: true,
      });
      if (!ok) return;
    }
    setAddingId(row.player_id);
    try {
      await postAddPlayer(row, { force: taken && isCommissioner });
      onAddToRoster?.();
    } catch (e) {
      setAddError(e.message || "Could not add player");
    } finally {
      setAddingId(null);
    }
  }, [isCommissioner, onAddToRoster, postAddPlayer]);

  const mobileLayout = useMobileLayout();

  const panelTitle = title || (isAvailableView ? "Available" : "Players");
  const panelSub = subtitle || (
    isAvailableView
      ? `${sorted.length} available${totalAvailable !== sorted.length ? ` of ${totalAvailable}` : ""}`
      : `${sorted.length} shown · ${totalAvailable} available`
  );

  const availabilityFilters = useMemo(() => {
    if (isAvailableView) return [];
    return sleeperLinked
      ? AVAILABILITY_FILTERS
      : AVAILABILITY_FILTERS.filter((f) => f.id !== "SLEEPER");
  }, [isAvailableView, sleeperLinked]);

  const availabilityFilterOptions = useMemo(
    () => availabilityFilters.map((f) => ({ id: f.id, label: f.label })),
    [availabilityFilters],
  );
  const positionOptions = useMemo(() => POSITIONS.map((p) => ({ id: p, label: p })), []);
  const tierOptions = useMemo(() => TIERS.map((t) => ({ id: t, label: t })), []);
  const riskOptions = useMemo(
    () => RISK_PROFILE_FILTERS.map((f) => ({ id: f.id, label: f.label })),
    [],
  );
  const sortMenuOptions = useMemo(() => {
    const opts = [...SORT_MENU_OPTIONS];
    if (!showDelta) return opts.filter((o) => o.id !== "value_delta");
    return opts;
  }, [showDelta]);

  const showSkeleton = loading && sorted.length === 0;

  const buildMobileMeta = useCallback((row) => {
    const parts = [];
    if (row.team) parts.push(row.team);
    if (row.position) parts.push(row.position);
    if (row.tier) parts.push(row.tier);
    return parts.join(" · ") || "—";
  }, []);

  const sheetClass = compact ? "hub-panel-compact" : "";
  const Wrapper = draftConsole ? "div" : HubPage;
  const wrapperClass = draftConsole
    ? `hub-embedded-sheet${sheetClass ? ` ${sheetClass}` : ""}`
    : sheetClass;

  return (
    <Wrapper className={wrapperClass}>
      {!hideHeader && !hideIntro && (
        <HubTabIntro
          title={panelTitle}
          compact={compact}
          learnMore={(showDelta || activeRisk) && !compact && !mobileLayout ? (
            <>
              {showDelta && (
                <p>
                  Value vs cost = contract salary minus suggested bid (negative = good value).
                </p>
              )}
              {activeRisk && (
                <p>
                  Risk-adjusted $ badges show how {riskToleranceLabel(riskTolerance)} stance
                  shifts fair value from season floor/ceiling variance.
                </p>
              )}
            </>
          ) : null}
        />
      )}

      {!hideHeader && (
        <div className="hub-page-meta">
          {panelSub}
          {sleeperLinked ? ` · ${sleeper.sleeper_team_name || "Sleeper linked"}` : ""}
          {seasonMethodNote ? (
            <>
              {" · "}
              <HoverTip content={seasonBandsTip} className="hub-page-meta-tip">
                {seasonMethodNote.text}
              </HoverTip>
            </>
          ) : null}
          {activeRisk ? ` · ${riskToleranceLabel(riskTolerance)} bids` : ""}
        </div>
      )}

      <div className={`hub-filter-bar${compact ? " hub-filter-bar--compact" : ""}`}>
        <input
          type="search"
          className="search-input hub-filter-search"
          placeholder="Search name or team…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search players"
        />
        <div className="hub-filter-bar-menus">
          <HubFilterMenu label="Pos" value={posFilter} options={positionOptions} onChange={setPosFilter} />
          {needPositions?.length > 0 && (
            <HubFilterChip
              compact={compact}
              active={needsOnly}
              onClick={() => setNeedsOnly((v) => !v)}
              title={`Pin ${needPositions.join(", ")} into the visible list (unmet minimums)`}
            >
              Needs {needPositions.join(" ")}
            </HubFilterChip>
          )}
          <HubFilterMenu
            label="Sort"
            value={sortKey}
            options={sortMenuOptions}
            onChange={(key) => {
              const next = nextSortState(sortKey, sortDir, key);
              // Selecting a new sort dimension from the menu always starts desc-first for metrics.
              if (key !== sortKey) {
                setSortKey(next.sortKey);
                setSortDir(next.sortDir);
              } else {
                setSortDir((d) => (d === "asc" ? "desc" : "asc"));
              }
            }}
          />
          <div className={`hub-more-filters${moreFiltersOpen ? " is-open" : ""}`}>
            <button
              type="button"
              className={`hub-more-filters-trigger${secondaryFilterCount > 0 ? " has-active" : ""}`}
              aria-expanded={moreFiltersOpen}
              aria-controls="hub-players-more-filters"
              onClick={() => setMoreFiltersOpen((open) => !open)}
            >
              More filters
              {secondaryFilterCount > 0 ? (
                <span className="hub-more-filters-count" aria-label={`${secondaryFilterCount} active`}>
                  {secondaryFilterCount}
                </span>
              ) : null}
              <span className="hub-filter-menu-caret" aria-hidden="true">
                {moreFiltersOpen ? "▴" : "▾"}
              </span>
            </button>
          </div>
        </div>
      </div>
      {moreFiltersOpen && (
        <div
          id="hub-players-more-filters"
          className="hub-more-filters-panel"
          role="region"
          aria-label="More player filters"
        >
          {showTierFilters && (
            <HubFilterMenu label="Tier" value={tierFilter} options={tierOptions} onChange={setTierFilter} />
          )}
          {availabilityFilterOptions.length > 0 && (
            <HubFilterMenu
              label="Pool"
              value={statusFilter}
              options={availabilityFilterOptions}
              onChange={setStatusFilter}
            />
          )}
          <HubFilterMenu
            label="Risk"
            value={riskProfile}
            options={riskOptions}
            onChange={setRiskProfile}
          />
          {showAdvancedToggle && (
            <label
              className="hub-advanced-toggle hub-advanced-toggle--compact"
              title="Adds team, per-game pace, projection spread, and min/max bid range when you need finer auction detail."
            >
              <input
                type="checkbox"
                checked={showAdvancedLocal}
                onChange={(e) => setShowAdvancedLocal(e.target.checked)}
              />
              Advanced
            </label>
          )}
        </div>
      )}
      {addError && <div className="error">{addError}</div>}
      {mobileLayout && (
        <div className="hub-filter-summary-bar" aria-live="polite">
          {sorted.length} shown
          {posFilter !== "ALL" ? ` · ${posFilter}` : ""}
          {tierFilter !== "ALL" ? ` · ${tierFilter}` : ""}
          {statusFilter !== "ALL" ? ` · ${statusFilter}` : ""}
          {riskProfile !== "ALL" ? ` · ${riskProfile}` : ""}
          {search.trim() ? ` · “${search.trim()}”` : ""}
          {` · sort ${sortKey}`}
        </div>
      )}
      <HubTableCard>
      {mobileLayout ? (
        <>
        <MobileDataList
          loading={showSkeleton}
          emptyMessage={!loading && sorted.length === 0 ? "No players match these filters." : null}
        >
          {mobileRows.map((r, idx) => {
            const inRoster = Boolean(rosterIds?.has(r.player_id));
            const statusLabel = formatStatusLabel(r.status);
            const band = resolveSeasonBand(r);
            const rangeTip = seasonRangeTooltip(band.method, { preliminary: band.preliminary });
            const actions = [];
            if (showSelect && onRowDoubleClick) {
              actions.push(
                <button
                  key="nominate"
                  type="button"
                  className="btn-primary btn-sm"
                  onClick={() => {
                    onSelectPlayer?.(r);
                    onRowDoubleClick(r);
                  }}
                >
                  {draftConsole ? `Nominate for $${Number(minBid || 1)}` : "Nominate"}
                </button>,
              );
            } else if (showSelect) {
              actions.push(
                <button
                  key="select"
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={() => onSelectPlayer?.(r)}
                >
                  Select
                </button>,
              );
            } else if (onRowDoubleClick) {
              actions.push(
                <button
                  key="nominate"
                  type="button"
                  className="btn-primary btn-sm"
                  onClick={() => onRowDoubleClick(r)}
                >
                  {draftConsole ? `Nominate for $${Number(minBid || 1)}` : "Nominate"}
                </button>,
              );
            }
            if (showAdd && !inRoster && !showSelect) {
              const taken = r.status === "taken";
              actions.push(
                <button
                  key="add"
                  type="button"
                  className="btn-ghost btn-sm"
                  disabled={addingId === r.player_id}
                  title={taken && !isCommissioner ? "Already on another roster" : undefined}
                  onClick={() => addPlayer(r)}
                >
                  {addingId === r.player_id ? "Adding…" : taken && isCommissioner ? "Reassign" : "Add"}
                </button>,
              );
            }

            return (
              <MobilePlayerCard
                key={r.player_id || `row-${idx}`}
                className={`${r.overpay ? "hub-overpay" : ""}${r.on_sleeper ? " hub-sleeper-row" : ""}`.trim()}
                name={r.player}
                meta={buildMobileMeta(r)}
                heroValue={(
                  <RaavBidCell
                    row={r}
                    riskTolerance={riskTolerance}
                    rules={rules}
                    showDeltaBadge={activeRisk
                      || (r.risk_adjusted_value != null
                        && Number.isFinite(Number(r.risk_adjusted_value)))}
                  />
                )}
                heroLabel="bid"
                selected={selectedPlayerId === r.player_id}
                onSelect={onSelectPlayer ? () => onSelectPlayer(r) : undefined}
                badge={r.is_rookie ? <span className="hub-sleeper-badge">Rookie est.</span> : null}
                expanded={(
                  <div className="mobile-stat-grid">
                    <MobileStat
                      label="Projected pts"
                      value={formatSeasonPts(band.p50, 0)}
                      title={rangeTip}
                    />
                    <MobileStat
                      label="Season range"
                      value={
                        band.p10 != null && band.p90 != null
                          ? `${formatSeasonPts(band.p10, 0)}–${formatSeasonPts(band.p90, 0)}${band.preliminary ? " · prelim" : ""}`
                          : "—"
                      }
                      title={rangeTip}
                    />
                    {showRiskScore && (
                      <MobileStat
                        label="Risk score"
                        value={formatRiskScore(r.risk_score)}
                        title={riskScoreTooltip()}
                      />
                    )}
                    {activeRisk && formatRaavDelta(raavDelta(r, riskTolerance, rules)) && (
                      <MobileStat
                        label="Risk-adj. Δ"
                        value={formatRaavDelta(raavDelta(r, riskTolerance, rules))}
                      />
                    )}
                    {showAdvanced && (
                      <>
                        <MobileStat
                          label="Spread"
                          value={band.spread != null ? formatSeasonPts(band.spread, 0) : "—"}
                        />
                        <MobileStat label="Per-game" value={r.per_game_proj ?? "—"} />
                        <MobileStat label="Min" value={fmtSal(r.min_sal)} />
                        <MobileStat label="Max" value={fmtSal(r.max_sal)} />
                      </>
                    )}
                    {showDelta && r.value_delta != null && (
                      <MobileStat
                        label="Value vs cost"
                        value={`${r.value_delta <= 0 ? "" : "+"}${fmtSal(r.value_delta)}`}
                        title="Contract salary minus suggested bid (negative = good value)"
                      />
                    )}
                    {showStatus && (
                      <MobileStat label="Status" value={statusLabel} />
                    )}
                  </div>
                )}
                actions={actions.length > 0 ? actions : null}
              />
            );
          })}
        </MobileDataList>
        {!maxRows && sorted.length > mobileListLimit && (
          <p className="hub-toolbar hub-load-more-row">
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => setMobileListLimit((n) => n + MOBILE_LIST_PAGE)}
            >
              Load more ({sorted.length - mobileListLimit} remaining)
            </button>
          </p>
        )}
        </>
      ) : (
      <div className="table-wrap table-sticky">
        <table className="data-table hub-table">
          <thead>
            <tr>
              <SortTh label="Player" col="player" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="col-player" />
              {showAdvanced && (
                <SortTh label="Team" col="team" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="hub-col-team" />
              )}
              {showPosCol && (
                <SortTh label="Pos" col="position" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="hub-col-pos" />
              )}
              <SortTh
                label="Projected pts"
                col="season_proj"
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={onSort}
                className="hub-col-proj"
                tip={projectedPointsTip}
              />
              {showAdvanced && (
                <>
                  <SortTh label="Per-game" col="per_game_proj" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="hub-col-pg" />
                  <SortTh
                    label="Spread"
                    col="season_spread"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={onSort}
                    className="hub-col-spread"
                    tip="Season ceiling minus floor (wider = more auction risk / upside)"
                  />
                  <SortTh label="Min" col="min_sal" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="hub-col-min" />
                  <SortTh label="Max" col="max_sal" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="hub-col-max" />
                </>
              )}
              {showValueRange && (
                <th className="hub-col-value" title="Model auction range (min–max) for this player">
                  Value
                </th>
              )}
              <SortTh
                label="Suggested bid"
                col="fair_value"
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={onSort}
                className="hub-col-fv"
                tip={activeRisk
                  ? `Primary bid uses risk-adjusted value (${riskToleranceLabel(riskTolerance)} stance)`
                  : "Neutral fair auction value from projected points rank"}
              />
              {showRiskScore && (
                <SortTh
                  label="Risk"
                  col="risk_score"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={onSort}
                  className="hub-col-risk"
                  tip={riskScoreTooltip()}
                />
              )}
              {showDelta && (
                <SortTh
                  label="Value vs cost"
                  col="value_delta"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={onSort}
                  className="hub-col-delta"
                  tip={VALUE_VS_COST_TIP}
                />
              )}
              <SortTh label="Tier" col="tier" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="hub-col-tier" />
              {showStatus && <SortTh label="Status" col="status" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="hub-col-status" />}
              {actionCol && <th className="hub-col-actions" aria-label="Actions" />}
            </tr>
          </thead>
          {showSkeleton ? (
            <TableSkeletonBody rows={14} cols={colCount} />
          ) : (
            <tbody>
              {!loading && sorted.length === 0 && (
                <tr>
                  <td colSpan={colCount} className="hub-roster-empty">No players match these filters.</td>
                </tr>
              )}
              {sorted.map((r, idx) => (
                <ValueSheetPlayerRow
                  draftConsole={draftConsole}
                  onQueuePlayer={onQueuePlayer}
                  onWatchPlayer={onWatchPlayer}
                  watchIds={watchIds}
                  canNominate={canNominate}
                  minBid={minBid}
                  key={r.player_id || `row-${idx}`}
                  row={r}
                  showAdvanced={showAdvanced}
                  showDelta={showDelta}
                  showStatus={showStatus}
                  showAdd={showAdd}
                  showSelect={showSelect}
                  showRiskScore={showRiskScore}
                  riskTolerance={riskTolerance}
                  rules={rules}
                  inRoster={Boolean(rosterIds?.has(r.player_id))}
                  isAdding={addingId === r.player_id}
                  isSelected={selectedPlayerId === r.player_id}
                  isCommissioner={isCommissioner}
                  onSelectPlayer={onSelectPlayer}
                  onRowDoubleClick={onRowDoubleClick}
                  onAddPlayer={addPlayer}
                  playerMedia={playerMedia}
                  narrativeScope={narrativeScope}
                  seasonScaleMax={seasonScaleMax}
                  rowIndex={idx}
                />
              ))}
            </tbody>
          )}
        </table>
      </div>
      )}
      </HubTableCard>
    </Wrapper>
  );
}
