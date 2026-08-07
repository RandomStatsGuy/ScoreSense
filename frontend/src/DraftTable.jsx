import React, { useMemo } from "react";
import QuantileBar from "./QuantileBarShared";
import { TableSkeleton } from "./TableSkeleton";
import useMobileLayout from "./useMobileLayout";
import MobileDataList, { MobileStat } from "./MobileDataList";
import MobilePlayerCard from "./MobilePlayerCard";
import PlayerCell, { usePlayerMedia } from "./PlayerCell";
import Chip from "./Chip";
import { fmtNum } from "./format";
import { SortHeader, ExportCsvButton, useTableSort, csvQuote, downloadCsv } from "./table";

const SORT_KEYS = {
  Player: "Player",
  Team: "Team",
  Proj: "Season Proj",
  PerGame: "Per-Game Proj",
  Floor: "Season Floor",
  Ceiling: "Season Ceiling",
};

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
        csvQuote(row.Player),
        row.Team || "",
        fmtNum(row["Season Proj"], 1, ""),
        fmtNum(row["Season Floor"], 1, ""),
        fmtNum(row["Season Ceiling"], 1, ""),
        fmtNum(row["Per-Game Proj"], 1, ""),
        fmtNum(row["Per-Game Floor"], 1, ""),
        fmtNum(row["Per-Game Ceiling"], 1, ""),
      ].join(",")
    ),
  ];
  downloadCsv("scoresense-draft", lines);
}

export default function DraftTable({ rows, search, metaLine, searchSlot, loading = false, position, season }) {
  const [sort, toggleSort] = useTableSort({ column: "Proj", dir: "desc" });
  const mobileLayout = useMobileLayout();

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
                heroValue={fmtNum(row["Season Proj"], 0)}
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
                      <MobileStat label="Per-game" value={fmtNum(row["Per-Game Proj"], 1)} />
                      <MobileStat label="Floor" value={fmtNum(row["Season Floor"], 0)} />
                      <MobileStat label="Ceiling" value={fmtNum(row["Season Ceiling"], 0)} />
                      <MobileStat label="PG floor" value={fmtNum(row["Per-Game Floor"], 1)} />
                      <MobileStat label="PG ceiling" value={fmtNum(row["Per-Game Ceiling"], 1)} />
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
                  <td>{row.Team ? <Chip tone="team">{row.Team}</Chip> : "—"}</td>
                  <td className="num num-proj">{fmtNum(row["Season Proj"], 0)}</td>
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
                    {fmtNum(row["Season Floor"], 0)}
                  </td>
                  <td className="num num-secondary col-floor-ceiling">
                    {fmtNum(row["Season Ceiling"], 0)}
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
