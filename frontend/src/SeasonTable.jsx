import React, { useMemo, useState } from "react";
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
import useMobileLayout from "./useMobileLayout";
import MobileDataList, { MobileStat } from "./MobileDataList";
import MobilePlayerCard from "./MobilePlayerCard";
import PlayerCell, { usePlayerMedia } from "./PlayerCell";
import SentimentBadge from "./SentimentBadge";

function SortHeader({ label, sortKey, sort, onSort, tip, className = "" }) {
  const active = sort.column === sortKey;
  const arrow = !active ? "↕" : sort.dir === "asc" ? "↑" : "↓";
  return (
    <th
      className={`sortable-header col-tip ${className}`.trim()}
      title={tip}
      onClick={() => onSort(sortKey)}
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
    >
      {label} <span className="sort-indicator">{arrow}</span>
    </th>
  );
}

function DownloadIcon() {
  return (
    <svg className="export-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3v12m0 0l4-4m-4 4l-4-4M5 21h14"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function exportCsv(rows, seasonComplete) {
  const baseHeader = ["Player", "Team", "Reg pts", "G", "PPG"];
  const rosHeader = ["Weeks Left", "Next Wk P50", "ROS P50", "Season P50", "Season P90"];
  const header = seasonComplete ? baseHeader : [...baseHeader, ...rosHeader];

  const lines = [
    header.join(","),
    ...rows.map((row) => {
      const base = [
        `"${String(row.Player).replace(/"/g, '""')}"`,
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

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `scoresense-season-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
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
}) {
  const [sort, setSort] = useState({ column: seasonComplete ? "PPG" : "SeasonP50", dir: "desc" });
  const mobileLayout = useMobileLayout();

  const filtered = useMemo(() => {
    let list = rows || [];
    const q = (search || "").trim().toLowerCase();
    if (q) {
      list = list.filter((r) => String(r.Player || "").toLowerCase().includes(q));
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

  const toggleSort = (column) => {
    setSort((prev) =>
      prev.column === column
        ? { column, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { column, dir: "desc" }
    );
  };

  const colCount = (seasonComplete ? 5 : 10) + (showNarrative ? 1 : 0);

  return (
    <>
      <div className="table-controls">
        {searchSlot}
        {!mobileLayout && (
          <button
            type="button"
            className="btn-export-csv"
            onClick={() => exportCsv(sorted, seasonComplete)}
            disabled={!sorted.length}
            title="Download filtered table as CSV"
          >
            <DownloadIcon />
            CSV
          </button>
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
        >
          {sorted.map((row) => {
            const heroValue = seasonComplete
              ? fmtNum(rosPPG(row))
              : fmtNum(rosSeasonP50(row));
            const heroLabel = seasonComplete ? "PPG" : "season";
            const meta = [row.Team || "—", `${fmtNum(rosRegPts(row))} reg pts`].join(" · ");

            return (
              <MobilePlayerCard
                key={`${row.player_id || row.Player}-${row.Team}`}
                name={row.Player}
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
      <div className="table-wrap table-sticky">
        <table>
          <thead>
            <tr>
              <SortHeader label="Player" sortKey="Player" sort={sort} onSort={toggleSort} />
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
            {sorted.length === 0 && (
              <tr>
                <td colSpan={colCount} className="muted">
                  {loading ? "Loading season totals…" : "No players match your filters."}
                </td>
              </tr>
            )}
            {sorted.map((row) => (
              <tr key={`${row.player_id || row.Player}-${row.Team}`}>
                <td>
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
                <td>{row.Team || "—"}</td>
                <td className="num">{fmtNum(rosRegPts(row))}</td>
                <td className="num muted">{rosGamesPlayed(row) ?? "—"}</td>
                <td className="num">{fmtNum(rosPPG(row))}</td>
                {!seasonComplete && (
                  <>
                    <td className="num muted">{row["Weeks Remaining"] ?? "—"}</td>
                    <td className="num">{fmtNum(rosNextWeekP50(row))}</td>
                    <td className="num">{fmtNum(rosP50(row))}</td>
                    <td className="num">{fmtNum(rosSeasonP50(row))}</td>
                    <td className="num num-secondary">{fmtNum(rosSeasonP90(row))}</td>
                  </>
                )}
                {showNarrative && (
                  <td className="col-narrative">
                    <SentimentBadge sentiment={row.sentiment} compact table />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
    </>
  );
}
