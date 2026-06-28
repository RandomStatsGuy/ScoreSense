import React, { useMemo, useState } from "react";
import Chip from "./Chip";
import { isPlayerUnavailable, unavailableLabel } from "./format";
import HoverTip from "./HoverTip";
import QuantileBar from "./QuantileBarShared";
import SentimentBadge from "./SentimentBadge";
import { TableSkeleton } from "./TableSkeleton";
import useMobileLayout from "./useMobileLayout";
import MobileDataList, { MobileStat } from "./MobileDataList";
import MobilePlayerCard from "./MobilePlayerCard";
import PlayerCell, { usePlayerMedia } from "./PlayerCell";

const SORT_KEYS = {
  Player: "Player",
  Team: "Team",
  Opponent: "Opponent",
  Narrative: "Narrative",
  P50: "Projected Points",
  P10: "Low (P10)",
  P90: "High (P90)",
  Injury: "Injury Boost",
};

function injuryBoostClass(boost) {
  const n = Number(boost);
  if (!Number.isFinite(n) || n === 0) return "injury-neutral";
  return n > 0 ? "injury-pos" : "injury-neg";
}

function SortHeader({ label, sortKey, sort, onSort, tip, className = "" }) {
  const active = sort.column === sortKey;
  const arrow = !active ? "↕" : sort.dir === "asc" ? "↑" : "↓";
  return (
    <HoverTip
      as="th"
      content={tip}
      className={`sortable-header col-tip ${className}`.trim()}
      onClick={() => onSort(sortKey)}
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
    >
      {label} <span className="sort-indicator">{arrow}</span>
    </HoverTip>
  );
}

function exportCsv(rows) {
  const header = ["Player", "Team", "Projected", "Floor", "Ceiling", "Injury Boost", "Injury Status"];
  const lines = [
    header.join(","),
    ...rows.map((row) => {
      const status = row["Injury Status"] || "";
      const unavailable = isPlayerUnavailable(status);
      return [
        `"${String(row.Player).replace(/"/g, '""')}"`,
        row.Team || "",
        unavailable ? "OUT" : Number(row["Projected Points"]).toFixed(2),
        unavailable ? "OUT" : Number(row["Low (P10)"]).toFixed(2),
        unavailable ? "OUT" : Number(row["High (P90)"]).toFixed(2),
        unavailable ? "" : row["Injury Boost"] ? (Number(row["Injury Boost"]) * 100).toFixed(1) : "",
        unavailable ? unavailableLabel(status) : status,
      ].join(",");
    }),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `scoresense-projections-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
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

export default function WeeklyTable({ rows, search, teamsFilter, searchSlot, metaLine, showSentiment = false, loading = false }) {
  const [sort, setSort] = useState({ column: "P50", dir: "desc" });
  const mobileLayout = useMobileLayout();

  const showOpponent = useMemo(
    () => (rows || []).some((row) => row.Opponent),
    [rows]
  );

  const hasSentiment = useMemo(
    () => showSentiment && (rows || []).some((row) => row.sentiment?.mention_count > 0),
    [rows, showSentiment]
  );

  const showBoost = useMemo(
    () =>
      (rows || []).some((row) => {
        const n = Number(row["Injury Boost"]);
        return Number.isFinite(n) && n !== 0;
      }),
    [rows]
  );

  const baseColCount = 3 + (showOpponent ? 1 : 0) + (hasSentiment ? 1 : 0) + (showBoost ? 1 : 0);
  const emptyColSpan = baseColCount;
  const unavailableColSpan = 2 + (showBoost ? 1 : 0);

  const filtered = useMemo(() => {
    let list = rows || [];
    const q = (search || "").trim().toLowerCase();
    if (q) {
      list = list.filter((r) => String(r.Player || "").toLowerCase().includes(q));
    }
    if (teamsFilter?.length) {
      const set = new Set(teamsFilter.map((t) => t.toUpperCase()));
      list = list.filter((r) => set.has(String(r.Team || "").toUpperCase()));
    }
    return list;
  }, [rows, search, teamsFilter]);

  const scaleMax = useMemo(() => {
    const slate = rows || [];
    if (!slate.length) return 1;
    const maxP90 = Math.max(...slate.map((r) => Number(r["High (P90)"]) || 0));
    return maxP90 > 0 ? maxP90 : 1;
  }, [rows]);

  const sorted = useMemo(() => {
    const key = SORT_KEYS[sort.column] || sort.column;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const aOut = isPlayerUnavailable(a["Injury Status"]);
      const bOut = isPlayerUnavailable(b["Injury Status"]);
      if (aOut !== bOut) return aOut ? 1 : -1;

      if (key === "Player" || key === "Team") {
        return dir * String(a[key] || "").localeCompare(String(b[key] || ""));
      }
      if (key === "Narrative") {
        const av = Number(a.sentiment?.mention_count) || 0;
        const bv = Number(b.sentiment?.mention_count) || 0;
        if (av !== bv) return dir * (av - bv);
        const as = Number(a.sentiment?.sentiment_score) || 0;
        const bs = Number(b.sentiment?.sentiment_score) || 0;
        return dir * (as - bs);
      }
      const av = Number(a[key]) || 0;
      const bv = Number(b[key]) || 0;
      return dir * (av - bv);
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

  const hasFilters = Boolean((search || "").trim() || teamsFilter?.length);
  const emptyMessage = loading
    ? null
    : hasFilters
      ? "No players match your search or team filters."
      : "No projections available for this week.";

  return (
    <>
      <div className="table-controls">
        {searchSlot}
        <button
          type="button"
          className="btn-export-csv"
          onClick={() => exportCsv(sorted)}
          disabled={!sorted.length}
          title="Download filtered table as CSV"
        >
          <DownloadIcon />
          CSV
        </button>
      </div>
      <div className="table-toolbar">
        <span className="table-meta">{sorted.length} players</span>
        {metaLine}
      </div>
      {mobileLayout ? (
        <MobileDataList
          loading={loading && sorted.length === 0}
          emptyMessage={!loading && sorted.length === 0 ? emptyMessage : null}
        >
          {sorted.map((row, rowIndex) => {
            const status = row["Injury Status"] || "";
            const unavailable = isPlayerUnavailable(status);
            const p50 = Number(row["Projected Points"]) || 0;
            const p10 = Number(row["Low (P10)"]) || 0;
            const p90 = Number(row["High (P90)"]) || 0;
            const tag = unavailableLabel(status);
            const metaParts = [row.Team || "—"];
            if (showOpponent && row.Opponent) metaParts.push(row.Opponent);

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
                  />
                )}
                meta={metaParts.join(" · ")}
                heroValue={unavailable ? tag : p50.toFixed(1)}
                heroLabel={unavailable ? "" : "proj"}
                heroMuted={unavailable}
                unavailable={unavailable}
                expanded={(
                  <>
                    {unavailable ? (
                      <p className="chart-note out-tag-note">Projections suppressed — Sleeper {status}</p>
                    ) : (
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
                          <MobileStat label="Floor" value={p10.toFixed(1)} />
                          <MobileStat label="Ceiling" value={p90.toFixed(1)} />
                          {showBoost && row["Injury Boost"] ? (
                            <MobileStat
                              label="Injury boost"
                              value={`${Number(row["Injury Boost"]) > 0 ? "+" : ""}${(Number(row["Injury Boost"]) * 100).toFixed(0)}%`}
                            />
                          ) : null}
                        </div>
                      </>
                    )}
                    {hasSentiment ? (
                      <div className="mobile-player-card-sentiment">
                        <SentimentBadge sentiment={row.sentiment} compact />
                      </div>
                    ) : null}
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
              <SortHeader label="Team" sortKey="Team" sort={sort} onSort={toggleSort} className="col-team" />
              {showOpponent && (
                <SortHeader
                  label="Opp"
                  sortKey="Opponent"
                  sort={sort}
                  onSort={toggleSort}
                  tip="Scheduled opponent this week (BYE if no game)"
                  className="col-opp"
                />
              )}
              {hasSentiment && (
                <SortHeader
                  label="Narrative"
                  sortKey="Narrative"
                  sort={sort}
                  onSort={toggleSort}
                  tip="Weekly beat/fantasy video tone — bullish, bearish, injury concern, or role hype"
                  className="col-narrative"
                />
              )}
              <SortHeader
                label="Proj"
                sortKey="P50"
                sort={sort}
                onSort={toggleSort}
                tip="Expected fantasy points this week (median projection)"
                className="col-proj"
              />
              <HoverTip
                as="th"
                className="col-tip col-range"
                content="Visual range from floor to ceiling. Hover for exact values; white tick = projected score."
              >
                Range
              </HoverTip>
              {showBoost && (
                <SortHeader
                  label="Boost"
                  sortKey="Injury"
                  sort={sort}
                  onSort={toggleSort}
                  tip="Extra opportunity when teammates are injured. +15% means the projection was raised 15%."
                />
              )}
            </tr>
          </thead>
          <tbody>
            {loading && sorted.length === 0 ? (
              <TableSkeleton rows={14} cols={emptyColSpan} />
            ) : (
              <>
            {sorted.length === 0 && emptyMessage && (
              <tr>
                <td colSpan={emptyColSpan} className="table-empty-state">
                  {emptyMessage}
                </td>
              </tr>
            )}
            {sorted.map((row, rowIndex) => {
              const status = row["Injury Status"] || "";
              const unavailable = isPlayerUnavailable(status);
              const p50 = Number(row["Projected Points"]) || 0;
              const p10 = Number(row["Low (P10)"]) || 0;
              const p90 = Number(row["High (P90)"]) || 0;
              const tag = unavailableLabel(status);

              return (
                <tr key={`${row.player_id || row.Player}-${row.Team}`} className={unavailable ? "row-unavailable" : undefined}>
                  <td className="col-player">
                    <PlayerCell
                      name={row.Player}
                      team={row.Team}
                      playerId={row.player_id}
                      media={playerMedia}
                      size="sm"
                      showTeam={false}
                    />
                    <span className="col-player-mobile-meta">
                      {row.Team || "—"}
                      {showOpponent && row.Opponent ? ` · ${row.Opponent}` : ""}
                    </span>
                  </td>
                  <td className="col-team">
                    {row.Team ? <Chip tone="team">{row.Team}</Chip> : "—"}
                  </td>
                  {showOpponent && (
                    <td className={`col-opp${row.Opponent === "BYE" ? " muted" : ""}`}>
                      {row.Opponent || "—"}
                    </td>
                  )}
                  {hasSentiment && (
                    <td className="col-narrative">
                      <SentimentBadge sentiment={row.sentiment} compact table />
                    </td>
                  )}
                  {unavailable ? (
                    <td colSpan={unavailableColSpan} className="out-tag-cell">
                      <span className="out-tag">{tag}</span>
                      <span className="out-tag-note">Projections suppressed — Sleeper {status}</span>
                    </td>
                  ) : (
                    <>
                      <td className="num num-proj">
                        <span className="col-proj-value">{p50.toFixed(1)}</span>
                        <span className="col-proj-mobile-range">
                          {p10.toFixed(1)}–{p90.toFixed(1)}
                        </span>
                      </td>
                      <td className="range-cell">
                        <QuantileBar
                          p10={p10}
                          p50={p50}
                          p90={p90}
                          scaleMax={scaleMax}
                          rowIndex={rowIndex}
                        />
                      </td>
                      {showBoost && (
                        <td className={`num ${injuryBoostClass(row["Injury Boost"])}`}>
                          {row["Injury Boost"]
                            ? `${Number(row["Injury Boost"]) > 0 ? "+" : ""}${(Number(row["Injury Boost"]) * 100).toFixed(0)}%`
                            : "—"}
                        </td>
                      )}
                    </>
                  )}
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
