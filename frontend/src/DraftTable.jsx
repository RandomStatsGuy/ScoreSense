import React, { useMemo, useState } from "react";
import ProjectionTierBoard from "./ProjectionTierBoard";
import {projectionPosition, projectionValue} from "./projectionTiers";
import useMobileLayout from "./useMobileLayout";
import { usePlayerMedia } from "./PlayerCell";
import { fmtNum } from "./format";
import {
  ExportCsvButton,
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
  BOARD_COPY, projectionNumber,
  matchesSeasonBoardFilter,
  positionShort,
  seasonBoardFilters,
  seasonBoardPreview,
  seasonPeerStats,
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

  const handleClearFilters = () => {
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
      preview: seasonBoardPreview(row, peerStats, {
        rank,
        position,
        method,
        scheduleAware,
      }),
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
      <ProjectionTierBoard position={position} rows={sorted} media={playerMedia} loading={loading}
        tierHorizon="season" tierBasis={BOARD_COPY.seasonTierBasis} sort={sort} onSort={toggleSort} numberDigits={0}
        emptyMessage={hasFilters ? "No players match your search." : "No draft projections available."}
        onClearFilters={hasFilters ? handleClearFilters : undefined} onOpen={openPlayer}
        getTierValue={row => resolveSeasonBand(row,{method}).p50 ?? row["Season Proj"]}
        columns={[
          {key:"perGame",label:BOARD_COPY.perGame,sortKey:"PerGame",digits:1},
          {key:"floor",label:BOARD_COPY.floor,sortKey:"Floor"},
          {key:"ceiling",label:BOARD_COPY.ceiling,sortKey:"Ceiling"},
          {key:"points",label:BOARD_COPY.seasonProjection,sortKey:"Proj"},
        ]}
        getView={row => {
          const band=resolveSeasonBand(row,{method});
          const perGame=projectionValue(row["Per-Game Proj"]);
          return {rank:rankMap.get(rowRankKey(row)),meta:[row.Team,projectionPosition(row,position)||positionShort(position)].filter(Boolean).join(" · "),
            badge:row["Rookie Est."]?<span className="rookie-est-badge" title={row["Rookie Role"]||"Rookie estimate"}>est.</span>:null,
            values:{perGame,floor:band.p10,ceiling:band.p90,points:band.p50??row["Season Proj"]},
            sub:perGame==null?null:`${projectionNumber(perGame)} /gm`};
        }}/>
    </>
  );
}
