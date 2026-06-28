import React, { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../auth";
import { parseApiError } from "../format";
import { TableSkeleton } from "../TableSkeleton";
import useMobileLayout from "../useMobileLayout";
import MobileDataList, { MobileStat } from "../MobileDataList";
import MobilePlayerCard from "../MobilePlayerCard";
import { usePlayerMedia } from "../PlayerCell";
import HubTabIntro from "./HubTabIntro";
import { HubPage, HubTableCard, HubFilterMenu } from "./HubUILayout";
import {
  filterAndSortRows,
  fmtSal,
  formatStatusLabel,
  nextSortState,
  sortIndicator,
} from "./valueSheetUtils";
import { HUB_POSITION_FILTERS } from "./hubPositions";
import ValueSheetPlayerRow from "./ValueSheetPlayerRow";

const TIERS = ["ALL", "Elite", "Tier 1", "Tier 2", "Tier 3", "Depth"];
const POSITIONS = HUB_POSITION_FILTERS;
const AVAILABILITY_FILTERS = [
  { id: "ALL", label: "All" },
  { id: "AVAILABLE", label: "Available" },
  { id: "TAKEN", label: "Taken" },
  { id: "MINE", label: "Mine" },
  { id: "SLEEPER", label: "Targets" },
];

function SortTh({ label, col, sortKey, sortDir, onSort, className = "", title }) {
  return (
    <th
      className={`sortable-header ${className}`.trim()}
      onClick={() => onSort(col)}
      title={title}
    >
      {label}
      <span className="sort-indicator"> {sortIndicator(sortKey, sortDir, col)}</span>
    </th>
  );
}

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
}) {
  const isAvailableView = mode === "available";
  const [sortKey, setSortKey] = useState("fair_value");
  const [sortDir, setSortDir] = useState("desc");
  const [posFilter, setPosFilter] = useState(defaultPosFilter);
  const [statusFilter, setStatusFilter] = useState(isAvailableView ? "AVAILABLE" : "ALL");
  const [tierFilter, setTierFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [addingId, setAddingId] = useState(null);
  const [showAdvancedLocal, setShowAdvancedLocal] = useState(false);

  const showAdvanced = showAdvancedProp ?? (compact ? true : showAdvancedLocal);

  const sleeperLinked = Boolean(sleeper?.sleeper_league_id && sleeper?.sleeper_roster_id);
  const showSelect = Boolean(onSelectPlayer);
  const actionCol = showAdd || showSelect;
  const baseCols = 4 + (showAdvanced ? 4 : 0) + 1 + (showDelta ? 1 : 0) + (showStatus ? 1 : 0) + (actionCol ? 1 : 0);
  const colCount = baseCols;

  useEffect(() => {
    setPosFilter(defaultPosFilter);
  }, [defaultPosFilter]);

  const sorted = useMemo(() => {
    const list = filterAndSortRows(rows, {
      pool: isAvailableView ? "available" : "all",
      posFilter,
      statusFilter: isAvailableView ? "ALL" : statusFilter,
      tierFilter,
      search,
      sortKey,
      sortDir,
    });
    return maxRows ? list.slice(0, maxRows) : list;
  }, [rows, isAvailableView, posFilter, statusFilter, tierFilter, search, sortKey, sortDir, maxRows]);

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

  const addPlayer = useCallback(async (row) => {
    const sal = row.fair_value ?? row.model_bid_hint ?? row.min_sal ?? 1;
    setAddingId(row.player_id);
    try {
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
        }),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      onAddToRoster?.();
    } finally {
      setAddingId(null);
    }
  }, [onAddToRoster]);

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
          learnMore={showDelta && !compact && !mobileLayout ? <p>Δ = contract minus suggested price (negative = value).</p> : null}
        />
      )}

      {!hideHeader && (
        <div className="hub-page-meta">
          {panelSub}
          {sleeperLinked ? ` · ${sleeper.sleeper_team_name || "Sleeper linked"}` : ""}
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
      <HubTableCard>
      {mobileLayout ? (
        <MobileDataList
          loading={showSkeleton}
          emptyMessage={!loading && sorted.length === 0 ? "No players match these filters." : null}
        >
          {sorted.map((r, idx) => {
            const inRoster = Boolean(rosterIds?.has(r.player_id));
            const statusLabel = formatStatusLabel(r.status);
            const actions = [];
            if (showSelect) {
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
            }
            if (onRowDoubleClick) {
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
              actions.push(
                <button
                  key="add"
                  type="button"
                  className="btn-ghost btn-sm"
                  disabled={addingId === r.player_id}
                  onClick={() => addPlayer(r)}
                >
                  {addingId === r.player_id ? "Adding…" : "Add"}
                </button>,
              );
            }

            return (
              <MobilePlayerCard
                key={r.player_id || `row-${idx}`}
                className={`${r.overpay ? "hub-overpay" : ""}${r.on_sleeper ? " hub-sleeper-row" : ""}`.trim()}
                name={r.player}
                meta={buildMobileMeta(r)}
                heroValue={fmtSal(r.fair_value ?? r.model_bid_hint)}
                heroLabel="bid"
                selected={selectedPlayerId === r.player_id}
                onSelect={onSelectPlayer ? () => onSelectPlayer(r) : undefined}
                badge={r.is_rookie ? <span className="hub-sleeper-badge">Rookie est.</span> : null}
                expanded={(
                  <div className="mobile-stat-grid">
                    {showAdvanced && (
                      <>
                        <MobileStat label="Season proj" value={r.season_proj ?? "—"} />
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
      ) : (
      <div className="table-wrap">
        <table className="data-table hub-table">
          <thead>
            <tr>
              <SortTh label="Player" col="player" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="col-player" />
              {showAdvanced && (
                <SortTh label="Team" col="team" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="hub-col-team" />
              )}
              <SortTh label="Pos" col="position" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="hub-col-pos" />
              {showAdvanced && (
                <>
                  <SortTh label="Season Proj" col="season_proj" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="hub-col-proj" />
                  <SortTh label="Per-game" col="per_game_proj" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="hub-col-pg" />
                  <SortTh label="Min" col="min_sal" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="hub-col-min" />
                  <SortTh label="Max" col="max_sal" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="hub-col-max" />
                </>
              )}
              <SortTh label="Suggested bid" col="fair_value" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="hub-col-fv" />
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
              {actionCol && <th />}
            </tr>
          </thead>
          {showSkeleton ? (
            <TableSkeleton rows={14} cols={colCount} />
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
                  inRoster={Boolean(rosterIds?.has(r.player_id))}
                  isAdding={addingId === r.player_id}
                  isSelected={selectedPlayerId === r.player_id}
                  onSelectPlayer={onSelectPlayer}
                  onRowDoubleClick={onRowDoubleClick}
                  onAddPlayer={addPlayer}
                  playerMedia={playerMedia}
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
