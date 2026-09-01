import React, { useMemo, useState } from "react";
import QuantileBar from "./QuantileBarShared";
import SeasonRangeCell from "./SeasonRangeCell";
import { TableSkeleton } from "./TableSkeleton";
import useMobileLayout from "./useMobileLayout";
import MobileDataList, { MobileStat } from "./MobileDataList";
import MobilePlayerCard from "./MobilePlayerCard";
import PlayerCell, { usePlayerMedia } from "./PlayerCell";
import { fmtNum } from "./format";
import {
  SortHeader,
  ExportCsvButton,
  TableEmptyState,
  useTableSort,
  useRankMap,
  rowRankKey,
  csvQuote,
  downloadCsv,
} from "./table";
import {
  formatSeasonPts,
  isScheduleAwareMethod,
  resolveSeasonBand,
  seasonRangeTooltip,
} from "./seasonQuantiles";
import { usePlayerCardOptional } from "./PlayerCardContext";
import {
  matchesSeasonBoardFilter,
  positionShort,
  seasonBoardFilters,
  seasonPeerStats,
  seasonRead,
} from "./projectionsPresentation";
import { ProjectionBoardHeader } from "./ProjectionBoardChrome";

const SORT_KEYS = {
  Player: "Player",
  Team: "Team",
  Proj: "Season Proj",
  PerGame: "Per-Game Proj",
  Floor: "Season Floor",
  Ceiling: "Season Ceiling",
  Spread: "Season Spread",
};

function exportCsv(rows) {
  const header = [
    "Player",
    "Team",
    "Season Proj",
    "Season Floor",
    "Season Ceiling",
    "Season Spread",
    "Per-Game Proj",
    "Per-Game Floor",
    "Per-Game Ceiling",
  ];
  const lines = [
    header.join(","),
    ...rows.map((row) => {
      const band = resolveSeasonBand(row);
      return [
        csvQuote(row.Player),
        row.Team || "",
        fmtNum(row["Season Proj"], 1, ""),
        fmtNum(band.p10 ?? row["Season Floor"], 1, ""),
        fmtNum(band.p90 ?? row["Season Ceiling"], 1, ""),
        fmtNum(band.spread ?? row["Season Spread"], 1, ""),
        fmtNum(row["Per-Game Proj"], 1, ""),
        fmtNum(row["Per-Game Floor"], 1, ""),
        fmtNum(row["Per-Game Ceiling"], 1, ""),
      ].join(",");
    }),
  ];
  downloadCsv("scoresense-draft", lines);
}

// Number(null) === 0; coerce missing projections to NaN so they stay unranked.
const rankBySeasonProj = (row) => Number(row["Season Proj"] ?? NaN);

export default function DraftTable({
  rows,
  search,
  metaLine,
  searchSlot,
  loading = false,
  position,
  season,
  seasonQuantileMethod,
  onClearFilters,
  hideBoardHeader = false,
  boardKicker,
  boardTitle,
  boardSupport,
}) {
  const [sort, toggleSort] = useTableSort({ column: "Proj", dir: "desc" });
  const [boardFilter, setBoardFilter] = useState("all");
  const mobileLayout = useMobileLayout();
  const playerCard = usePlayerCardOptional();
  const rankMap = useRankMap(rows, rankBySeasonProj);
  const hasFilters = Boolean((search || "").trim() || boardFilter !== "all");
  const method = seasonQuantileMethod
    || rows?.find((r) => r.season_quantile_method)?.season_quantile_method
    || null;
  const scheduleAware = isScheduleAwareMethod(method);
  const seasonTip = seasonRangeTooltip(method, { preliminary: !scheduleAware });

  const filtered = useMemo(() => {
    let list = rows || [];
    const q = (search || "").trim().toLowerCase();
    if (q) {
      list = list.filter(
        (r) =>
          String(r.Player || "").toLowerCase().includes(q) ||
          String(r.Team || "").toLowerCase().includes(q),
      );
    }
    return list;
  }, [rows, search]);

  const seasonScaleMax = useMemo(() => {
    let max = 0;
    for (const row of rows || []) {
      const band = resolveSeasonBand(row, { method });
      if (band.p90 != null && band.p90 > max) max = band.p90;
    }
    return max > 0 ? max : 1;
  }, [rows, method]);

  const peerStats = useMemo(() => seasonPeerStats(rows, { method }), [rows, method]);
  const boardFilters = useMemo(() => seasonBoardFilters((rows || []).length), [rows]);

  const boardFiltered = useMemo(() => {
    if (boardFilter === "all") return filtered;
    return filtered.filter((row) => {
      const rank = rankMap.get(rowRankKey(row)) ?? null;
      const band = resolveSeasonBand(row, { method });
      return matchesSeasonBoardFilter(boardFilter, {
        rank,
        spread: band.spread,
        peers: peerStats,
        position,
      });
    });
  }, [filtered, boardFilter, rankMap, method, peerStats, position]);

  const sorted = useMemo(() => {
    const key = SORT_KEYS[sort.column] || sort.column;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...boardFiltered].sort((a, b) => {
      if (key === "Player" || key === "Team") {
        return dir * String(a[key] || "").localeCompare(String(b[key] || ""));
      }
      if (key === "Season Spread") {
        const as = resolveSeasonBand(a, { method }).spread ?? 0;
        const bs = resolveSeasonBand(b, { method }).spread ?? 0;
        return dir * (as - bs);
      }
      return dir * ((Number(a[key]) || 0) - (Number(b[key]) || 0));
    });
  }, [boardFiltered, sort, method]);

  const playerIds = useMemo(
    () => sorted.map((r) => r.player_id).filter(Boolean),
    [sorted],
  );
  const playerMedia = usePlayerMedia(playerIds);

  const clearFilters = () => {
    setBoardFilter("all");
    onClearFilters?.();
  };

  const openPlayer = (row) => {
    if (!row?.player_id || !playerCard) return;
    const rank = rankMap.get(rowRankKey(row)) ?? null;
    playerCard.openPlayerCard({
      playerId: row.player_id,
      name: row.Player,
      team: row.Team,
      position,
      season,
      scope: "season",
      seasonMode: "preseason",
      rank,
      peers: peerStats,
    });
  };

  return (
    <>
      {!hideBoardHeader ? (
        <ProjectionBoardHeader
          kicker={boardKicker}
          title={boardTitle}
          support={boardSupport}
          filters={boardFilters}
          activeFilter={boardFilter}
          onFilterChange={setBoardFilter}
        />
      ) : null}
      <div className="table-controls">
        {searchSlot}
        {!mobileLayout && (
          <ExportCsvButton onExport={() => exportCsv(sorted)} disabled={!sorted.length} />
        )}
      </div>
      <div className="table-toolbar">
        <span className="table-meta">{sorted.length} players</span>
        {metaLine}
      </div>
      {mobileLayout ? (
        <MobileDataList
          loading={loading && sorted.length === 0}
          emptyMessage={
            !loading && sorted.length === 0
              ? hasFilters
                ? "No players match your search."
                : "No draft projections available."
              : null
          }
          onEmptyAction={hasFilters && sorted.length === 0 ? clearFilters : undefined}
        >
          {sorted.map((row, rowIndex) => {
            const band = resolveSeasonBand(row, { method });
            const seasonP50 = band.p50 ?? (Number(row["Season Proj"]) || 0);
            const rookieBadge = row["Rookie Est."] ? (
              <span
                className="rookie-est-badge"
                title={row["Rookie Role"] ? `Rookie estimate · ${row["Rookie Role"]}` : "Rookie role-adjusted estimate"}
              >
                est.
              </span>
            ) : null;

            return (
              <MobilePlayerCard
                key={rowRankKey(row)}
                name={row.Player}
                rank={rankMap.get(rowRankKey(row)) ?? null}
                titleNode={(
                  <PlayerCell
                    name={row.Player}
                    team={row.Team}
                    playerId={row.player_id}
                    media={playerMedia}
                    size="sm"
                    showTeam={false}
                    clickable={Boolean(row.player_id)}
                    narrativeScope="season"
                    position={position}
                    season={season}
                  />
                )}
                meta={row.Team || "—"}
                heroValue={fmtNum(row["Season Proj"], 0)}
                heroLabel="season"
                heroSub={`${fmtNum(row["Per-Game Proj"], 1)} /gm`}
                badge={rookieBadge}
                expanded={(
                  <>
                    <div className="range-cell">
                      <QuantileBar
                        p10={band.p10 ?? 0}
                        p50={seasonP50}
                        p90={band.p90 ?? 0}
                        scaleMax={seasonScaleMax}
                        rowIndex={rowIndex}
                        title={seasonTip}
                        subtitle={`${formatSeasonPts(band.p10, 0)} – ${formatSeasonPts(band.p90, 0)} season pts`}
                      />
                    </div>
                    <div className="mobile-stat-grid">
                      <MobileStat label="Per-game" value={fmtNum(row["Per-Game Proj"], 1)} />
                      <MobileStat
                        label="Floor"
                        value={formatSeasonPts(band.p10 ?? row["Season Floor"], 0)}
                        title={seasonTip}
                      />
                      <MobileStat
                        label="Ceiling"
                        value={formatSeasonPts(band.p90 ?? row["Season Ceiling"], 0)}
                        title={seasonTip}
                      />
                    </div>
                  </>
                )}
              />
            );
          })}
        </MobileDataList>
      ) : (
      <div className="table-wrap table-sticky table-has-rank">
        <table>
          <thead>
            <tr>
              <th className="num col-rank" title="Position rank by projected season total">#</th>
              <SortHeader label="Player" sortKey="Player" sort={sort} onSort={toggleSort} className="col-player" />
              <SortHeader
                label="P10"
                sortKey="Floor"
                sort={sort}
                onSort={toggleSort}
                className="col-floor-ceiling"
                tip={scheduleAware ? "Season P10 (schedule-aware)" : "Season floor (preliminary)"}
              />
              <SortHeader
                label="P50"
                sortKey="Proj"
                sort={sort}
                onSort={toggleSort}
                className="col-proj"
                tip={seasonTip}
              />
              <SortHeader
                label="P90"
                sortKey="Ceiling"
                sort={sort}
                onSort={toggleSort}
                className="col-floor-ceiling"
                tip={scheduleAware ? "Season P90 (schedule-aware)" : "Season ceiling (preliminary)"}
              />
              <SortHeader
                label="Per game"
                sortKey="PerGame"
                sort={sort}
                onSort={toggleSort}
                className="col-per-game"
                tip="Season projection divided by expected games"
              />
              <th className="col-range" title={seasonTip}>Season range</th>
              <th className="proj-read" title="Short range and role read">Read</th>
            </tr>
          </thead>
          <tbody>
            {loading && sorted.length === 0 ? (
              <TableSkeleton rows={14} cols={8} />
            ) : (
              <>
            {sorted.length === 0 && (
              <TableEmptyState
                colSpan={8}
                message={hasFilters ? "No players match your search." : "No draft projections available."}
                actionLabel="Clear filters"
                onAction={hasFilters ? clearFilters : undefined}
              />
            )}
            {sorted.map((row, rowIndex) => {
              const band = resolveSeasonBand(row, { method });
              const seasonP50 = band.p50 ?? (Number(row["Season Proj"]) || 0);
              const rank = rankMap.get(rowRankKey(row)) ?? null;
              return (
                <tr
                  key={rowRankKey(row)}
                  className="proj-board-row"
                  tabIndex={row.player_id && playerCard ? 0 : undefined}
                  aria-label={row.player_id && playerCard ? `Open ${row.Player} details` : undefined}
                  onClick={() => openPlayer(row)}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return;
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openPlayer(row);
                    }
                  }}
                >
                  <td className={`num col-rank${rank != null && rank <= 3 ? " col-rank-top" : ""}`}>
                    {rank ?? "—"}
                  </td>
                  <td className="col-player">
                    <PlayerCell
                      name={row.Player}
                      team={row.Team}
                      playerId={row.player_id}
                      media={playerMedia}
                      size="sm"
                      showTeam={false}
                      clickable={false}
                      narrativeScope="season"
                      position={positionShort(position)}
                      season={season}
                    />
                    {row["Rookie Est."] ? (
                      <span
                        className="rookie-est-badge"
                        title={row["Rookie Role"] ? `Rookie estimate · ${row["Rookie Role"]}` : "Rookie role-adjusted estimate"}
                      >
                        est.
                      </span>
                    ) : null}
                  </td>
                  <td className="num num-quantile col-floor-ceiling">
                    {formatSeasonPts(band.p10 ?? row["Season Floor"], 0)}
                  </td>
                  <td className="num num-proj num-p50">
                    <SeasonRangeCell
                      row={row}
                      method={method}
                      scaleMax={seasonScaleMax}
                      rowIndex={rowIndex}
                      digits={0}
                      showBar={false}
                    />
                  </td>
                  <td className="num num-quantile col-floor-ceiling">
                    {formatSeasonPts(band.p90 ?? row["Season Ceiling"], 0)}
                  </td>
                  <td className="num col-per-game">{fmtNum(row["Per-Game Proj"], 1)}</td>
                  <td className="range-cell">
                    <QuantileBar
                      p10={band.p10 ?? 0}
                      p50={seasonP50}
                      p90={band.p90 ?? 0}
                      scaleMax={seasonScaleMax}
                      rowIndex={rowIndex}
                      title={seasonTip}
                      subtitle={`${formatSeasonPts(band.p10, 0)} – ${formatSeasonPts(band.p90, 0)} season pts`}
                    />
                  </td>
                  <td className="proj-read">
                    {seasonRead(row, peerStats, { rank, position, method })}
                  </td>
                </tr>
              );
            })}
              </>
            )}
          </tbody>
        </table>
      </div>
      )}
    </>
  );
}
