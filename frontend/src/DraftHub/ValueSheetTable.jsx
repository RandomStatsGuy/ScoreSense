import React, { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../auth";
import { parseApiError } from "../format";
import { TableSkeletonBody } from "../TableSkeleton";
import useMobileLayout from "../useMobileLayout";
import MobileDataList, { MobileStat } from "../MobileDataList";
import MobilePlayerCard from "../MobilePlayerCard";
import { usePlayerMedia } from "../PlayerCell";
import { confirmDialog } from "../ui/confirm";
import HubTabIntro from "./HubTabIntro";
import { HubPage, HubTableCard, HubFilterMenu, SortTh } from "./HubUILayout";
import {
  filterAndSortRows,
  fmtSal,
  formatStatusLabel,
  nextSortState,
} from "./valueSheetUtils";
import { HUB_POSITION_FILTERS } from "./hubPositions";
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
  { id: "season_proj", label: "Season P50" },
  { id: "season_spread", label: "Season spread" },
  { id: "upside_skew", label: "Upside skew" },
  { id: "value_delta", label: "Δ vs contract" },
  { id: "player", label: "Name" },
];

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
}) {
  const isAvailableView = mode === "available";
  const [sortKey, setSortKey] = useState("fair_value");
  const [sortDir, setSortDir] = useState("desc");
  const [posFilter, setPosFilter] = useState(defaultPosFilter);
  const [statusFilter, setStatusFilter] = useState(isAvailableView ? "AVAILABLE" : "ALL");
  const [tierFilter, setTierFilter] = useState("ALL");
  const [riskProfile, setRiskProfile] = useState("ALL");
  const [search, setSearch] = useState("");
  const [addingId, setAddingId] = useState(null);
  const [addError, setAddError] = useState("");
  const [showAdvancedLocal, setShowAdvancedLocal] = useState(false);
  const [mobileListLimit, setMobileListLimit] = useState(80);

  const MOBILE_LIST_PAGE = 80;

  const showAdvanced = showAdvancedProp ?? (compact ? true : showAdvancedLocal);
  const activeRisk = isRiskToleranceActive(riskTolerance);
  // Risk score column: Advanced always; also when RAAV stance is on so the badge has context.
  const showRiskScore = showAdvanced || activeRisk;

  const sleeperLinked = Boolean(sleeper?.sleeper_league_id && sleeper?.sleeper_roster_id);
  const showSelect = Boolean(onSelectPlayer);
  const actionCol = showAdd || showSelect;
  // Core: Player, Pos, Season, Bid, Tier (+ optional Status/Δ/Action/Risk). Advanced adds Team/PG/Spread/Min/Max.
  const baseCols = 5
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
    const list = filterAndSortRows(rows, {
      pool: isAvailableView ? "available" : "all",
      posFilter,
      statusFilter: isAvailableView ? "ALL" : statusFilter,
      tierFilter,
      riskProfile,
      search,
      sortKey,
      sortDir,
    });
    return maxRows ? list.slice(0, maxRows) : list;
  }, [rows, isAvailableView, posFilter, statusFilter, tierFilter, riskProfile, search, sortKey, sortDir, maxRows]);

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
      return label;
    }
    return label || "preliminary season bands";
  }, [rows, seasonMethod]);

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

  return (
    <HubPage className={compact ? "hub-panel-compact" : ""}>
      {!hideHeader && !hideIntro && (
        <HubTabIntro
          title={panelTitle}
          compact={compact}
          learnMore={(showDelta || activeRisk) && !compact && !mobileLayout ? (
            <>
              {showDelta && <p>Δ = contract minus suggested price (negative = value).</p>}
              {activeRisk && (
                <p>
                  Risk-adjusted $ badges show how {riskToleranceLabel(riskTolerance)} stance
                  shifts fair value from season P10/P90 variance.
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
          {seasonMethodNote ? ` · ${seasonMethodNote}` : ""}
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
        </div>
        {!compact && showAdvancedProp == null && (
          <label className="hub-advanced-toggle hub-advanced-toggle--compact">
            <input
              type="checkbox"
              checked={showAdvancedLocal}
              onChange={(e) => setShowAdvancedLocal(e.target.checked)}
            />
            Advanced
          </label>
        )}
      </div>
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
                  Nominate
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
                  Nominate
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
                      label="Season P50"
                      value={formatSeasonPts(band.p50, 0)}
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
                        label="RAAV Δ"
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
                        label="Δ vs contract"
                        value={`${r.value_delta <= 0 ? "" : "+"}${fmtSal(r.value_delta)}`}
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
              <SortTh label="Pos" col="position" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="hub-col-pos" />
              <SortTh
                label="Season"
                col="season_proj"
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={onSort}
                className="hub-col-proj"
                title={seasonRangeTooltip(seasonMethod, {
                  preliminary: !isScheduleAwareMethod(seasonMethod),
                })}
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
                    title="Season P90 − P10 (wider = more auction risk / upside)"
                  />
                  <SortTh label="Min" col="min_sal" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="hub-col-min" />
                  <SortTh label="Max" col="max_sal" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="hub-col-max" />
                </>
              )}
              <SortTh
                label="Suggested bid"
                col="fair_value"
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={onSort}
                className="hub-col-fv"
                title={activeRisk
                  ? `Primary bid uses risk-adjusted value (${riskToleranceLabel(riskTolerance)} stance)`
                  : "Neutral fair auction value from Season Proj rank"}
              />
              {showRiskScore && (
                <SortTh
                  label="Risk"
                  col="risk_score"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={onSort}
                  className="hub-col-risk"
                  title={riskScoreTooltip()}
                />
              )}
              {showDelta && (
                <SortTh
                  label="Δ"
                  col="value_delta"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={onSort}
                  className="hub-col-delta"
                  title="Your contract minus suggested price (negative = good value)"
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
    </HubPage>
  );
}
