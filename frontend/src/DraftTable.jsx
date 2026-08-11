import React, { useMemo } from "react";
import QuantileBar from "./QuantileBarShared";
import SeasonRangeCell from "./SeasonRangeCell";
import { TableSkeleton } from "./TableSkeleton";
import useMobileLayout from "./useMobileLayout";
import MobileDataList, { MobileStat } from "./MobileDataList";
import MobilePlayerCard from "./MobilePlayerCard";
import PlayerCell, { usePlayerMedia } from "./PlayerCell";
import Chip from "./Chip";
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

const rankBySeasonProj = (row) => Number(row["Season Proj"]);

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
}) {
  const [sort, toggleSort] = useTableSort({ column: "Proj", dir: "desc" });
  const mobileLayout = useMobileLayout();
  const rankMap = useRankMap(rows, rankBySeasonProj);
  const hasFilters = Boolean((search || "").trim());
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

  const scaleMax = useMemo(() => {
    const slate = rows || [];
    if (!slate.length) return 1;
    const maxP90 = Math.max(...slate.map((r) => Number(r["Per-Game Ceiling"]) || 0));
    return maxP90 > 0 ? maxP90 : 1;
  }, [rows]);

  const seasonScaleMax = useMemo(() => {
    let max = 0;
    for (const row of rows || []) {
      const band = resolveSeasonBand(row, { method });
      if (band.p90 != null && band.p90 > max) max = band.p90;
    }
    return max > 0 ? max : 1;
  }, [rows, method]);

  const sorted = useMemo(() => {
    const key = SORT_KEYS[sort.column] || sort.column;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
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
  }, [filtered, sort, method]);

  const playerIds = useMemo(
    () => sorted.map((r) => r.player_id).filter(Boolean),
    [sorted],
  );
  const playerMedia = usePlayerMedia(playerIds);

  return (
    <>
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
          onEmptyAction={hasFilters && sorted.length === 0 ? onClearFilters : undefined}
        >
          {sorted.map((row, rowIndex) => {
            const p50 = Number(row["Per-Game Proj"]) || 0;
            const p10 = Number(row["Per-Game Floor"]) || 0;
            const p90 = Number(row["Per-Game Ceiling"]) || 0;
            const band = resolveSeasonBand(row, { method });
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
                          p50={band.p50 ?? (Number(row["Season Proj"]) || 0)}
                        p90={band.p90 ?? 0}
                        scaleMax={seasonScaleMax}
                        rowIndex={rowIndex}
                        title={seasonTip}
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
                      <MobileStat label="PG floor" value={fmtNum(row["Per-Game Floor"], 1)} />
                      <MobileStat label="PG ceiling" value={fmtNum(row["Per-Game Ceiling"], 1)} />
                      <div className="range-cell">
                        <QuantileBar
                          p10={p10}
                          p50={p50}
                          p90={p90}
                          scaleMax={scaleMax}
                          rowIndex={rowIndex}
                          title="Per-game scoring range"
                        />
                      </div>
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
              <SortHeader label="Team" sortKey="Team" sort={sort} onSort={toggleSort} />
              <SortHeader
                label="Season"
                sortKey="Proj"
                sort={sort}
                onSort={toggleSort}
                className="col-proj"
                tip={seasonTip}
              />
              <th className="col-range" title="Weekly floor to ceiling range (per game)">Per-game range</th>
              <SortHeader
                label="Floor"
                sortKey="Floor"
                sort={sort}
                onSort={toggleSort}
                className="col-floor-ceiling"
                tip={scheduleAware ? "Season P10 (schedule-aware)" : "Season floor (preliminary)"}
              />
              <SortHeader
                label="Ceiling"
                sortKey="Ceiling"
                sort={sort}
                onSort={toggleSort}
                className="col-floor-ceiling"
                tip={scheduleAware ? "Season P90 (schedule-aware)" : "Season ceiling (preliminary)"}
              />
              <SortHeader
                label="Per-game"
                sortKey="PerGame"
                sort={sort}
                onSort={toggleSort}
                tip="Season projection divided by expected games"
              />
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
                onAction={hasFilters ? onClearFilters : undefined}
              />
            )}
            {sorted.map((row, rowIndex) => {
              const p50 = Number(row["Per-Game Proj"]) || 0;
              const p10 = Number(row["Per-Game Floor"]) || 0;
              const p90 = Number(row["Per-Game Ceiling"]) || 0;
              const band = resolveSeasonBand(row, { method });
              const rank = rankMap.get(rowRankKey(row)) ?? null;
              return (
                <tr key={rowRankKey(row)}>
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
                      clickable={Boolean(row.player_id)}
                      narrativeScope="season"
                      position={position}
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
                  <td>{row.Team ? <Chip tone="team">{row.Team}</Chip> : "—"}</td>
                  <td className="num num-proj">
                    <SeasonRangeCell
                      row={row}
                      method={method}
                      scaleMax={seasonScaleMax}
                      rowIndex={rowIndex}
                      digits={0}
                    />
                  </td>
                  <td className="range-cell">
                    <QuantileBar
                      p10={p10}
                      p50={p50}
                      p90={p90}
                      scaleMax={scaleMax}
                      rowIndex={rowIndex}
                      title="Per-game scoring range"
                    />
                  </td>
                  <td className="num num-secondary col-floor-ceiling">
                    {formatSeasonPts(band.p10 ?? row["Season Floor"], 0)}
                  </td>
                  <td className="num num-secondary col-floor-ceiling">
                    {formatSeasonPts(band.p90 ?? row["Season Ceiling"], 0)}
                  </td>
                  <td className="num">{fmtNum(row["Per-Game Proj"], 1)}</td>
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
