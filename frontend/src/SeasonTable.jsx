import React, { useMemo } from "react";
import {
  fmtNum,
  rosGamesPlayed,
  rosNextWeekP50,
  rosPPG,
  rosP50,
  rosRegPts,
  rosSeasonP50,
  rosSeasonP90,
} from "./format";
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
import useMobileLayout from "./useMobileLayout";
import MobileDataList, { MobileStat } from "./MobileDataList";
import MobilePlayerCard from "./MobilePlayerCard";
import PlayerCell, { usePlayerMedia } from "./PlayerCell";
import SentimentBadge from "./SentimentBadge";
import Chip from "./Chip";
import { TableSkeleton } from "./TableSkeleton";

function exportCsv(rows, seasonComplete) {
  const baseHeader = ["Player", "Team", "Reg pts", "G", "PPG"];
  const rosHeader = ["Weeks Left", "Next Wk P50", "ROS P50", "Season P50", "Season P90"];
  const header = seasonComplete ? baseHeader : [...baseHeader, ...rosHeader];

  const lines = [
    header.join(","),
    ...rows.map((row) => {
      const base = [
        csvQuote(row.Player),
        row.Team || "",
        fmtNum(rosRegPts(row), 1, ""),
        rosGamesPlayed(row) ?? "",
        fmtNum(rosPPG(row), 1, ""),
      ];
      if (seasonComplete) return base.join(",");
      return [
        ...base,
        row["Weeks Remaining"] ?? "",
        fmtNum(rosNextWeekP50(row), 1, ""),
        fmtNum(rosP50(row), 1, ""),
        fmtNum(rosSeasonP50(row), 1, ""),
        fmtNum(rosSeasonP90(row), 1, ""),
      ].join(",");
    }),
  ];

  downloadCsv("scoresense-season", lines);
}

function sortValue(row, key) {
  switch (key) {
    case "Player":
      return String(row.Player || "");
    case "Team":
      return String(row.Team || "");
    case "RegPts":
      return Number(rosRegPts(row)) || 0;
    case "G":
      return Number(rosGamesPlayed(row)) || 0;
    case "PPG":
      return Number(rosPPG(row)) || 0;
    case "Left":
      return Number(row["Weeks Remaining"]) || 0;
    case "NextP50":
      return Number(rosNextWeekP50(row)) || 0;
    case "RosP50":
      return Number(rosP50(row)) || 0;
    case "SeasonP50":
      return Number(rosSeasonP50(row)) || 0;
    case "SeasonP90":
      return Number(rosSeasonP90(row)) || 0;
    case "Narrative":
      return Number(row.sentiment?.mention_count) || 0;
    default:
      return 0;
  }
}

const rankByPPG = (row) => Number(rosPPG(row));
const rankBySeasonP50 = (row) => Number(rosSeasonP50(row));

export default function SeasonTable({
  rows,
  seasonComplete,
  projectionWeek,
  search,
  searchSlot,
  metaLine,
  loading = false,
  showSentiment = false,
  position,
  season,
  week,
  onClearFilters,
}) {
  const [sort, toggleSort] = useTableSort({ column: seasonComplete ? "PPG" : "SeasonP50", dir: "desc" });
  const mobileLayout = useMobileLayout();

  // Position rank over the full slate: PPG once the season is final,
  // projected season total (P50) while it is live.
  const rankMap = useRankMap(rows, seasonComplete ? rankByPPG : rankBySeasonP50);

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

  const sorted = useMemo(() => {
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = sortValue(a, sort.column);
      const bv = sortValue(b, sort.column);
      if (sort.column === "Player" || sort.column === "Team") {
        return dir * String(av).localeCompare(String(bv));
      }
      return dir * (av - bv);
    });
  }, [filtered, sort]);

  const playerIds = useMemo(
    () => sorted.map((r) => r.player_id).filter(Boolean),
    [sorted],
  );
  const playerMedia = usePlayerMedia(playerIds);

  const showNarrative = useMemo(
    () => showSentiment && (rows || []).some((row) => Number(row.sentiment?.mention_count) > 0),
    [rows, showSentiment],
  );

  const colCount = (seasonComplete ? 6 : 11) + (showNarrative ? 1 : 0);
  const hasFilters = Boolean((search || "").trim());

  return (
    <>
      <div className="table-controls">
        {searchSlot}
        {!mobileLayout && (
          <ExportCsvButton onExport={() => exportCsv(sorted, seasonComplete)} disabled={!sorted.length} />
        )}
      </div>
      <div className="table-toolbar">
        <span className="table-meta">{sorted.length} players</span>
        {metaLine}
      </div>
      {mobileLayout ? (
        <MobileDataList
          loading={loading && sorted.length === 0}
          emptyMessage={!loading && sorted.length === 0 ? "No players match your filters." : null}
          onEmptyAction={hasFilters && sorted.length === 0 ? onClearFilters : undefined}
        >
          {sorted.map((row) => {
            const heroValue = seasonComplete
              ? fmtNum(rosPPG(row))
              : fmtNum(rosSeasonP50(row));
            const heroLabel = seasonComplete ? "PPG" : "season";
            const meta = [row.Team || "—", `${fmtNum(rosRegPts(row))} reg pts`].join(" · ");

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
                    week={week ?? projectionWeek}
                  />
                )}
                meta={meta}
                heroValue={heroValue}
                heroLabel={heroLabel}
                expanded={(
                  <div className="mobile-stat-grid">
                    <MobileStat label="Reg pts" value={fmtNum(rosRegPts(row))} />
                    <MobileStat label="Games" value={rosGamesPlayed(row) ?? "—"} />
                    <MobileStat label="PPG" value={fmtNum(rosPPG(row))} />
                    {!seasonComplete && (
                      <>
                        <MobileStat label="Weeks left" value={row["Weeks Remaining"] ?? "—"} />
                        <MobileStat label={`Wk ${projectionWeek ?? "?"} P50`} value={fmtNum(rosNextWeekP50(row))} />
                        <MobileStat label="ROS P50" value={fmtNum(rosP50(row))} />
                        <MobileStat label="Season P50" value={fmtNum(rosSeasonP50(row))} />
                        <MobileStat label="Season P90" value={fmtNum(rosSeasonP90(row))} />
                      </>
                    )}
                  </div>
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
              <th
                className="num col-rank"
                title={seasonComplete ? "Position rank by points per game" : "Position rank by projected season total"}
              >
                #
              </th>
              <SortHeader label="Player" sortKey="Player" sort={sort} onSort={toggleSort} className="col-player" />
              <SortHeader label="Team" sortKey="Team" sort={sort} onSort={toggleSort} />
              <SortHeader
                label="Reg pts"
                sortKey="RegPts"
                sort={sort}
                onSort={toggleSort}
                tip="Regular-season fantasy points scored (weeks 1–18)"
                className="num"
              />
              <SortHeader
                label="G"
                sortKey="G"
                sort={sort}
                onSort={toggleSort}
                tip="Regular-season games played"
                className="num"
              />
              <SortHeader
                label="PPG"
                sortKey="PPG"
                sort={sort}
                onSort={toggleSort}
                tip="Reg pts ÷ games — normalizes for missed games"
                className="num"
              />
              {!seasonComplete && (
                <>
                  <SortHeader
                    label="Left"
                    sortKey="Left"
                    sort={sort}
                    onSort={toggleSort}
                    tip="Regular-season weeks remaining"
                    className="num"
                  />
                  <SortHeader
                    label={`Wk ${projectionWeek ?? "?"} P50`}
                    sortKey="NextP50"
                    sort={sort}
                    onSort={toggleSort}
                    tip="P50 projection for the upcoming week"
                    className="num"
                  />
                  <SortHeader
                    label="ROS P50"
                    sortKey="RosP50"
                    sort={sort}
                    onSort={toggleSort}
                    tip="Next-week P50 × weeks remaining"
                    className="num"
                  />
                  <SortHeader
                    label="Season P50"
                    sortKey="SeasonP50"
                    sort={sort}
                    onSort={toggleSort}
                    tip="Reg pts + ROS P50"
                    className="num"
                  />
                  <SortHeader
                    label="Season P90"
                    sortKey="SeasonP90"
                    sort={sort}
                    onSort={toggleSort}
                    tip="Reg pts + ROS P90 ceiling"
                    className="num"
                  />
                </>
              )}
              {showNarrative && (
                <SortHeader
                  label="Fantasy"
                  sortKey="Narrative"
                  sort={sort}
                  onSort={toggleSort}
                  tip="Season-to-date fantasy analyst narrative"
                  className="col-narrative"
                />
              )}
            </tr>
          </thead>
          <tbody>
            {loading && sorted.length === 0 && (
              <TableSkeleton rows={14} cols={colCount} />
            )}
            {!loading && sorted.length === 0 && (
              <TableEmptyState
                colSpan={colCount}
                message="No players match your filters."
                actionLabel="Clear filters"
                onAction={hasFilters ? onClearFilters : undefined}
              />
            )}
            {sorted.map((row) => {
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
                    week={week ?? projectionWeek}
                  />
                </td>
                <td>{row.Team ? <Chip tone="team">{row.Team}</Chip> : "—"}</td>
                <td className="num">{fmtNum(rosRegPts(row))}</td>
                <td className="num muted">{rosGamesPlayed(row) ?? "—"}</td>
                <td className={`num${seasonComplete ? " num-proj" : ""}`}>{fmtNum(rosPPG(row))}</td>
                {!seasonComplete && (
                  <>
                    <td className="num muted">{row["Weeks Remaining"] ?? "—"}</td>
                    <td className="num">{fmtNum(rosNextWeekP50(row))}</td>
                    <td className="num">{fmtNum(rosP50(row))}</td>
                    <td className="num num-proj">{fmtNum(rosSeasonP50(row))}</td>
                    <td className="num num-secondary">{fmtNum(rosSeasonP90(row))}</td>
                  </>
                )}
                {showNarrative && (
                  <td className="col-narrative">
                    <SentimentBadge sentiment={row.sentiment} compact table />
                  </td>
                )}
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}
    </>
  );
}
