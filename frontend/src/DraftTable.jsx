import React, { useMemo, useState } from "react";
import QuantileBar from "./QuantileBarShared";
import { TableSkeleton } from "./TableSkeleton";
import useMobileLayout from "./useMobileLayout";
import MobileDataList, { MobileStat } from "./MobileDataList";
import MobilePlayerCard from "./MobilePlayerCard";
import PlayerCell, { usePlayerMedia } from "./PlayerCell";

const SORT_KEYS = {
  Player: "Player",
  Team: "Team",
  Proj: "Season Proj",
  PerGame: "Per-Game Proj",
  Floor: "Season Floor",
  Ceiling: "Season Ceiling",
};

function SortHeader({ label, sortKey, sort, onSort, className = "", tip }) {
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

function exportCsv(rows) {
  const header = [
    "Player",
    "Team",
    "Season Proj",
    "Season Floor",
    "Season Ceiling",
    "Per-Game Proj",
    "Per-Game Floor",
    "Per-Game Ceiling",
  ];
  const lines = [
    header.join(","),
    ...rows.map((row) =>
      [
        `"${String(row.Player).replace(/"/g, '""')}"`,
        row.Team || "",
        Number(row["Season Proj"]).toFixed(1),
        Number(row["Season Floor"]).toFixed(1),
        Number(row["Season Ceiling"]).toFixed(1),
        Number(row["Per-Game Proj"]).toFixed(1),
        Number(row["Per-Game Floor"]).toFixed(1),
        Number(row["Per-Game Ceiling"]).toFixed(1),
      ].join(",")
    ),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `scoresense-draft-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function DraftTable({ rows, search, metaLine, searchSlot, loading = false, position, season }) {
  const [sort, setSort] = useState({ column: "Proj", dir: "desc" });
  const mobileLayout = useMobileLayout();

  const filtered = useMemo(() => {
    let list = rows || [];
    const q = (search || "").trim().toLowerCase();
    if (q) {
      list = list.filter((r) => String(r.Player || "").toLowerCase().includes(q));
    }
    return list;
  }, [rows, search]);

  const scaleMax = useMemo(() => {
    if (!filtered.length) return 1;
    const maxP90 = Math.max(...filtered.map((r) => Number(r["Per-Game Ceiling"]) || 0));
    return maxP90 > 0 ? maxP90 : 1;
  }, [filtered]);

  const sorted = useMemo(() => {
    const key = SORT_KEYS[sort.column] || sort.column;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (key === "Player" || key === "Team") {
        return dir * String(a[key] || "").localeCompare(String(b[key] || ""));
      }
      return dir * ((Number(a[key]) || 0) - (Number(b[key]) || 0));
    });
  }, [filtered, sort]);

  const playerIds = useMemo(
    () => sorted.map((r) => r.player_id).filter(Boolean),
    [sorted],
  );
  const playerMedia = usePlayerMedia(playerIds);

  const toggleSort = (column) => {
    setSort((prev) =>
      prev.column === column
        ? { column, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { column, dir: "desc" }
    );
  };

  return (
    <>
      <div className="table-controls">
        {searchSlot}
        {!mobileLayout && (
          <button
            type="button"
            className="btn-export-csv"
            onClick={() => exportCsv(sorted)}
            disabled={!sorted.length}
          >
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
          emptyMessage={!loading && sorted.length === 0 ? "No draft projections available." : null}
        >
          {sorted.map((row, rowIndex) => {
            const p50 = Number(row["Per-Game Proj"]) || 0;
            const p10 = Number(row["Per-Game Floor"]) || 0;
            const p90 = Number(row["Per-Game Ceiling"]) || 0;
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
                  />
                )}
                meta={row.Team || "—"}
                heroValue={Number(row["Season Proj"]).toFixed(0)}
                heroLabel="season"
                badge={rookieBadge}
                expanded={(
                  <>
                    <div className="range-cell">
                      <QuantileBar
                        p10={p10}
                        p50={p50}
                        p90={p90}
                        scaleMax={scaleMax}
                        rowIndex={rowIndex}
                      />
                    </div>
                    <div className="mobile-stat-grid">
                      <MobileStat label="Per-game" value={p50.toFixed(1)} />
                      <MobileStat label="Floor" value={Number(row["Season Floor"]).toFixed(0)} />
                      <MobileStat label="Ceiling" value={Number(row["Season Ceiling"]).toFixed(0)} />
                      <MobileStat label="PG floor" value={p10.toFixed(1)} />
                      <MobileStat label="PG ceiling" value={p90.toFixed(1)} />
                    </div>
                  </>
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
                label="Season Proj"
                sortKey="Proj"
                sort={sort}
                onSort={toggleSort}
                className="col-proj"
                tip="Expected full-season PPR total"
              />
              <th className="col-range" title="Weekly floor to ceiling range (per game)">Per-game range</th>
              <SortHeader
                label="Floor"
                sortKey="Floor"
                sort={sort}
                onSort={toggleSort}
                className="col-floor-ceiling"
                tip="Season floor (P10)"
              />
              <SortHeader
                label="Ceiling"
                sortKey="Ceiling"
                sort={sort}
                onSort={toggleSort}
                className="col-floor-ceiling"
                tip="Season ceiling (P90)"
              />
              <SortHeader
                label="Per-game"
                sortKey="PerGame"
                sort={sort}
                onSort={toggleSort}
                tip="Season projection divided by games"
              />
            </tr>
          </thead>
          <tbody>
            {loading && sorted.length === 0 ? (
              <TableSkeleton rows={14} cols={7} />
            ) : (
              <>
            {sorted.length === 0 && (
              <tr>
                <td colSpan={7} className="table-empty-state">
                  No draft projections available.
                </td>
              </tr>
            )}
            {sorted.map((row, rowIndex) => {
              const p50 = Number(row["Per-Game Proj"]) || 0;
              const p10 = Number(row["Per-Game Floor"]) || 0;
              const p90 = Number(row["Per-Game Ceiling"]) || 0;
              return (
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
                  <td>{row.Team || "—"}</td>
                  <td className="num num-proj">{Number(row["Season Proj"]).toFixed(0)}</td>
                  <td className="range-cell">
                    <QuantileBar
                      p10={p10}
                      p50={p50}
                      p90={p90}
                      scaleMax={scaleMax}
                      rowIndex={rowIndex}
                    />
                  </td>
                  <td className="num num-secondary col-floor-ceiling">
                    {Number(row["Season Floor"]).toFixed(0)}
                  </td>
                  <td className="num num-secondary col-floor-ceiling">
                    {Number(row["Season Ceiling"]).toFixed(0)}
                  </td>
                  <td className="num">{p50.toFixed(1)}</td>
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
