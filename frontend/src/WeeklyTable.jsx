import React, { useEffect, useMemo, useState } from "react";
import Chip, { injuryChipTone } from "./Chip";
import { fmtNum, isPlayerUnavailable, unavailableLabel } from "./format";
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
import QuantileBar from "./QuantileBarShared";
import SentimentBadge from "./SentimentBadge";
import ProjectionExplanationPanel from "./ProjectionExplanationPanel";
import { TableSkeleton } from "./TableSkeleton";
import useMobileLayout from "./useMobileLayout";
import MobileDataList, { MobileStat } from "./MobileDataList";
import MobilePlayerCard from "./MobilePlayerCard";
import PlayerCell, { usePlayerMedia } from "./PlayerCell";
import { usePlayerCardOptional } from "./PlayerCardContext";

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

/** DvP tone from "Opp Def Rank" (1 = toughest defense). Bottom third = favorable. */
function matchupTone(rank, teamCount) {
  const r = Number(rank);
  if (!Number.isFinite(r) || !teamCount) return null;
  if (r <= Math.floor(teamCount / 3)) return "bad";
  if (r > Math.ceil((teamCount * 2) / 3)) return "good";
  return null;
}

function matchupTitle(rank, teamCount, position) {
  const r = Number(rank);
  if (!Number.isFinite(r) || !teamCount) return undefined;
  const vs = position === "rb" ? "the run" : "the pass";
  const tone = matchupTone(r, teamCount);
  const label =
    tone === "good" ? "favorable matchup" : tone === "bad" ? "tough matchup" : "average matchup";
  return `Opponent defense ranks ${r} of ${teamCount} vs ${vs} (1 = toughest) — ${label}`;
}

/** Abbreviated injury designation shown inline next to the player name. */
function injuryAbbrev(status) {
  const s = String(status || "").toLowerCase();
  if (s.includes("questionable")) return "Q";
  if (s.includes("doubtful")) return "D";
  if (s.includes("probable")) return "P";
  return null;
}

export function InjuryStatusTag({ status }) {
  const abbrev = injuryAbbrev(status);
  if (!abbrev) return null;
  return (
    <Chip
      tone={injuryChipTone(status)}
      className="player-status-chip"
      title={`Injury status: ${status}`}
      aria-label={`Injury status: ${status}`}
    >
      {abbrev}
    </Chip>
  );
}

function WhyToggleButton({ playerName, expanded, onToggle }) {
  return (
    <button
      type="button"
      className={`btn-ghost btn-sm why-toggle${expanded ? " why-toggle--open" : ""}`}
      onClick={(event) => {
        event.stopPropagation();
        onToggle?.();
      }}
      aria-expanded={expanded}
      aria-label={`Why this projection for ${playerName || "player"}`}
      title="Why this projection?"
    >
      Why?
    </button>
  );
}

const WeeklyTableRow = React.memo(function WeeklyTableRow({
  row,
  rowIndex,
  rank,
  showOpponent,
  hasSentiment,
  showBoost,
  unavailableColSpan,
  scaleMax,
  playerMedia,
  position,
  season,
  week,
  dvpTeamCount,
  compareEnabled,
  selected,
  selectDisabled,
  onToggleSelect,
  whyExpanded,
  onToggleWhy,
  whyColSpan,
  applyInjuryAdjustments,
}) {
  const status = row["Injury Status"] || "";
  const unavailable = isPlayerUnavailable(status);
  const p50 = Number(row["Projected Points"]) || 0;
  const p10 = Number(row["Low (P10)"]) || 0;
  const p90 = Number(row["High (P90)"]) || 0;
  const tag = unavailableLabel(status);
  const tone = matchupTone(row["Opp Def Rank"], dvpTeamCount);
  const canSelect = compareEnabled && Boolean(row.player_id) && !unavailable;
  const canExplain = Boolean(row.player_id);

  return (
    <>
    <tr
      className={[
        unavailable ? "row-unavailable" : "",
        selected ? "row-compare-selected" : "",
        whyExpanded ? "row-why-open" : "",
      ]
        .filter(Boolean)
        .join(" ") || undefined}
    >
      {compareEnabled ? (
        <td className="col-compare-select">
          <label className="compare-select-label">
            <input
              type="checkbox"
              checked={selected}
              disabled={!canSelect || (selectDisabled && !selected)}
              onChange={() => onToggleSelect?.(row)}
              aria-label={`Select ${row.Player || "player"} for compare`}
            />
          </label>
        </td>
      ) : null}
      <td className={`num col-rank${rank != null && rank <= 3 ? " col-rank-top" : ""}`}>
        {rank ?? "—"}
      </td>
      <td className="col-player">
        <span className="col-player-inner">
          <PlayerCell
            name={row.Player}
            team={row.Team}
            playerId={row.player_id}
            media={playerMedia}
            size="sm"
            showTeam={false}
            clickable={Boolean(row.player_id)}
            position={position}
            season={season}
            week={week}
            applyInjuryAdjustments={applyInjuryAdjustments}
          />
          <InjuryStatusTag status={unavailable ? "" : status} />
          {canExplain ? (
            <WhyToggleButton
              playerName={row.Player}
              expanded={whyExpanded}
              onToggle={onToggleWhy}
            />
          ) : null}
        </span>
        <span className="col-player-mobile-meta">
          {row.Team || "—"}
          {showOpponent && row.Opponent ? ` · ${row.Opponent}` : ""}
        </span>
      </td>
      <td className="col-team">
        {row.Team ? <Chip tone="team">{row.Team}</Chip> : "—"}
      </td>
      {showOpponent && (
        <td
          className={`col-opp${row.Opponent === "BYE" ? " muted" : ""}${tone ? ` matchup-${tone}` : ""}`}
          title={matchupTitle(row["Opp Def Rank"], dvpTeamCount, position)}
        >
          {row.Opponent || "—"}
          {tone ? (
            <span className={`matchup-indicator matchup-indicator-${tone}`} aria-hidden="true">
              {tone === "good" ? "▲" : "▼"}
            </span>
          ) : null}
          {tone ? (
            <span className="sr-only">
              {tone === "good" ? "favorable matchup" : "tough matchup"}
            </span>
          ) : null}
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
            <span className="col-proj-value">{fmtNum(row["Projected Points"], 1)}</span>
            <span className="col-proj-mobile-range">
              {fmtNum(row["Low (P10)"], 1)}–{fmtNum(row["High (P90)"], 1)}
            </span>
          </td>
          <td className="range-cell">
            <QuantileBar
              p10={p10}
              p50={p50}
              p90={p90}
              scaleMax={scaleMax}
              rowIndex={rowIndex}
              showVolatility
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
    {whyExpanded && canExplain ? (
      <tr className="row-why-panel">
        <td colSpan={whyColSpan}>
          <ProjectionExplanationPanel
            playerId={row.player_id}
            season={season}
            week={week}
            position={position}
            applyInjuryAdjustments={applyInjuryAdjustments}
            active
          />
        </td>
      </tr>
    ) : null}
    </>
  );
});

function exportCsv(rows) {
  const header = ["Player", "Team", "Projected", "Floor", "Ceiling", "Injury Boost", "Injury Status"];
  const lines = [
    header.join(","),
    ...rows.map((row) => {
      const status = row["Injury Status"] || "";
      const unavailable = isPlayerUnavailable(status);
      const boost = Number(row["Injury Boost"]);
      return [
        csvQuote(row.Player),
        row.Team || "",
        unavailable ? "OUT" : fmtNum(row["Projected Points"], 2, ""),
        unavailable ? "OUT" : fmtNum(row["Low (P10)"], 2, ""),
        unavailable ? "OUT" : fmtNum(row["High (P90)"], 2, ""),
        !unavailable && Number.isFinite(boost) && boost !== 0 ? (boost * 100).toFixed(1) : "",
        unavailable ? unavailableLabel(status) : status,
      ].join(",");
    }),
  ];
  downloadCsv("scoresense-projections", lines);
}

// Number(null) === 0; coerce missing projections to NaN so they stay unranked.
const rankMetric = (row) =>
  isPlayerUnavailable(row["Injury Status"]) ? NaN : Number(row["Projected Points"] ?? NaN);

export default function WeeklyTable({
  rows,
  search,
  teamsFilter,
  searchSlot,
  metaLine,
  showSentiment = false,
  loading = false,
  position,
  season,
  week,
  applyInjuryAdjustments = true,
  onClearFilters,
  /** SCORE-4: enable 2–4 player start/sit multi-select. */
  compareEnabled = false,
  selectedCompareIds = null,
  maxCompare = 4,
  onToggleCompare,
  onOpenCompare,
  onClearCompare,
  onRemoveCompare,
  compareSelectionMeta = null,
}) {
  const [sort, toggleSort] = useTableSort({ column: "P50", dir: "desc" });
  const [whyPlayerId, setWhyPlayerId] = useState(null);
  const mobileLayout = useMobileLayout();
  const playerCard = usePlayerCardOptional();
  const selectedSet = useMemo(
    () => new Set((selectedCompareIds || []).map(String)),
    [selectedCompareIds],
  );
  const selectedCount = selectedSet.size;
  const selectDisabled = selectedCount >= maxCompare;

  const toggleWhy = (playerId) => {
    const id = playerId ? String(playerId) : "";
    if (!id) return;
    setWhyPlayerId((prev) => (prev === id ? null : id));
  };

  useEffect(() => {
    setWhyPlayerId(null);
  }, [position, season, week, applyInjuryAdjustments]);

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

  // Select, Rank, Player, Team, Proj, Range are base; Opp/Narrative/Boost are conditional.
  const baseColCount =
    5 +
    (compareEnabled ? 1 : 0) +
    (showOpponent ? 1 : 0) +
    (hasSentiment ? 1 : 0) +
    (showBoost ? 1 : 0);
  const emptyColSpan = baseColCount;
  const unavailableColSpan = 2 + (showBoost ? 1 : 0);

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

  // Number of ranked defenses in the slate (max observed rank) for DvP bucketing.
  const dvpTeamCount = useMemo(() => {
    let max = 0;
    for (const r of rows || []) {
      const rank = Number(r["Opp Def Rank"]);
      if (Number.isFinite(rank) && rank > max) max = rank;
    }
    return max;
  }, [rows]);

  const sorted = useMemo(() => {
    const key = SORT_KEYS[sort.column] || sort.column;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const aOut = isPlayerUnavailable(a["Injury Status"]);
      const bOut = isPlayerUnavailable(b["Injury Status"]);
      if (aOut !== bOut) return aOut ? 1 : -1;

      if (key === "Player" || key === "Team" || key === "Opponent") {
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

  // Position rank over the full slate (stable regardless of sort/filter).
  const rankMap = useRankMap(rows, rankMetric);

  const hasFilters = Boolean((search || "").trim() || teamsFilter?.length);
  const emptyMessage = loading
    ? null
    : hasFilters
      ? "No players match your search or team filters."
      : "No projections available for this week.";

  const resultLabel =
    selectedCount > 0
      ? `${sorted.length} result${sorted.length === 1 ? "" : "s"} · ${selectedCount} selected`
      : `${sorted.length} player${sorted.length === 1 ? "" : "s"}`;

  return (
    <>
      <div className="table-controls">
        {searchSlot}
        {!mobileLayout && (
          <ExportCsvButton onExport={() => exportCsv(sorted)} disabled={!sorted.length} />
        )}
      </div>
      <div className="table-toolbar">
        <span className="table-meta">{resultLabel}</span>
        {metaLine}
        {!mobileLayout ? (
          <span className="table-meta range-scale-legend range-scale-legend--toolbar" aria-hidden="true">
            <span>Floor</span>
            <span>Projection</span>
            <span>Ceiling</span>
          </span>
        ) : null}
        {compareEnabled ? (
          <span className="table-meta table-meta-compare-hint">
            Compare 2–{maxCompare} players
          </span>
        ) : null}
      </div>
      {compareEnabled && selectedCount > 0 ? (
        <div className="compare-selection-bar" role="region" aria-label="Compare selection">
          <div className="compare-selection-meta">
            <strong>
              {selectedCount} selected
            </strong>
            <span className="muted">
              {selectedCount < 2
                ? ` · pick ${2 - selectedCount} more`
                : selectedCount >= maxCompare
                  ? ` · max ${maxCompare}`
                  : ` · up to ${maxCompare}`}
            </span>
            {compareSelectionMeta?.length ? (
              <div className="compare-selection-chips">
                {compareSelectionMeta.map((p) => {
                  const id = String(p.player_id || "");
                  const name = p.name || id;
                  return (
                    <button
                      key={id}
                      type="button"
                      className="compare-selection-chip"
                      onClick={() => onRemoveCompare?.(id)}
                      aria-label={`Remove ${name} from compare`}
                      title={`Remove ${name}`}
                    >
                      <span>{name}</span>
                      <span aria-hidden="true">×</span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
          <div className="compare-selection-actions">
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={onClearCompare}
            >
              Clear
            </button>
            <button
              type="button"
              className="btn primary btn-sm"
              disabled={selectedCount < 2}
              onClick={onOpenCompare}
            >
              Compare
            </button>
          </div>
        </div>
      ) : null}
      {mobileLayout ? (
        <MobileDataList
          loading={loading && sorted.length === 0}
          emptyMessage={!loading && sorted.length === 0 ? emptyMessage : null}
          onEmptyAction={hasFilters && sorted.length === 0 ? onClearFilters : undefined}
        >
          {sorted.map((row, rowIndex) => {
            const status = row["Injury Status"] || "";
            const unavailable = isPlayerUnavailable(status);
            const p50 = Number(row["Projected Points"]) || 0;
            const p10 = Number(row["Low (P10)"]) || 0;
            const p90 = Number(row["High (P90)"]) || 0;
            const tag = unavailableLabel(status);
            const tone = matchupTone(row["Opp Def Rank"], dvpTeamCount);
            const pid = row.player_id ? String(row.player_id) : "";
            const selected = pid ? selectedSet.has(pid) : false;
            const canSelect = compareEnabled && Boolean(pid) && !unavailable;
            const metaNode = (
              <>
                {row.Team || "—"}
                {showOpponent && row.Opponent ? (
                  <>
                    {" · "}
                    <span className={tone ? `matchup-${tone}` : undefined}>
                      {row.Opponent}
                      {tone ? (
                        <span
                          className={`matchup-indicator matchup-indicator-${tone}`}
                          aria-hidden="true"
                        >
                          {tone === "good" ? "▲" : "▼"}
                        </span>
                      ) : null}
                      {tone ? (
                        <span className="sr-only">
                          {tone === "good" ? "favorable matchup" : "tough matchup"}
                        </span>
                      ) : null}
                    </span>
                  </>
                ) : null}
              </>
            );

            return (
              <MobilePlayerCard
                key={rowRankKey(row)}
                name={row.Player}
                rank={rankMap.get(rowRankKey(row)) ?? null}
                selected={selected}
                titleNode={(
                  <PlayerCell
                    name={row.Player}
                    team={row.Team}
                    playerId={row.player_id}
                    media={playerMedia}
                    size="sm"
                    showTeam={false}
                    clickable={false}
                  />
                )}
                badge={unavailable ? null : <InjuryStatusTag status={status} />}
                meta={metaNode}
                heroValue={unavailable ? tag : fmtNum(row["Projected Points"], 1)}
                heroLabel={unavailable ? "" : "proj"}
                heroSub={unavailable ? null : `${fmtNum(p10, 1)}–${fmtNum(p90, 1)}`}
                heroMuted={unavailable}
                unavailable={unavailable}
                actions={
                  pid || compareEnabled ? (
                    <div className="mobile-player-card-action-row">
                      {pid && playerCard ? (
                        <button
                          type="button"
                          className="btn-ghost btn-sm"
                          onClick={() =>
                            playerCard.openPlayerCard({
                              playerId: pid,
                              name: row.Player,
                              team: row.Team,
                              position,
                              season,
                              week,
                              applyInjuryAdjustments,
                              scope: "weekly",
                            })
                          }
                        >
                          Details
                        </button>
                      ) : null}
                      {pid ? (
                        <WhyToggleButton
                          playerName={row.Player}
                          expanded={whyPlayerId === pid}
                          onToggle={() => toggleWhy(pid)}
                        />
                      ) : null}
                      {compareEnabled ? (
                        <label className="compare-select-label compare-select-label--mobile">
                          <input
                            type="checkbox"
                            checked={selected}
                            disabled={!canSelect || (selectDisabled && !selected)}
                            onChange={() => onToggleCompare?.(row)}
                            aria-label={`Select ${row.Player || "player"} for compare`}
                          />
                          <span>Compare</span>
                        </label>
                      ) : null}
                    </div>
                  ) : null
                }
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
                            showVolatility
                          />
                        </div>
                        <div className="mobile-stat-grid">
                          <MobileStat label="Floor" value={fmtNum(row["Low (P10)"], 1)} />
                          <MobileStat label="Ceiling" value={fmtNum(row["High (P90)"], 1)} />
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
                    {pid && whyPlayerId === pid ? (
                      <ProjectionExplanationPanel
                        playerId={pid}
                        season={season}
                        week={week}
                        position={position}
                        applyInjuryAdjustments={applyInjuryAdjustments}
                        active
                        className="projection-explanation--mobile"
                      />
                    ) : null}
                  </>
                )}
              />
            );
          })}
        </MobileDataList>
      ) : (
      <div className={`table-wrap table-sticky table-has-rank${compareEnabled ? " table-has-compare" : ""}`}>
        <table>
          <thead>
            <tr>
              {compareEnabled ? (
                <th className="col-compare-select" title="Select players to compare (2–4)">
                  <span className="sr-only">Compare</span>
                </th>
              ) : null}
              <th className="num col-rank" title="Position rank by projected points">#</th>
              <SortHeader label="Player" sortKey="Player" sort={sort} onSort={toggleSort} className="col-player" />
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
                  label="Analyst signal"
                  sortKey="Narrative"
                  sort={sort}
                  onSort={toggleSort}
                  tip="Fantasy analyst signal — hover a tag for recency and digest preview"
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
              <SortHeader
                label="Range"
                sortKey="P90"
                sort={sort}
                onSort={toggleSort}
                tip="Floor / Projection / Ceiling (P10 · P50 · P90). Sorts by ceiling. White tick = projected score; amber = boom/bust spread."
                className="col-range"
              />
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
              <TableEmptyState
                colSpan={emptyColSpan}
                message={emptyMessage}
                actionLabel="Clear filters"
                onAction={hasFilters ? onClearFilters : undefined}
              />
            )}
            {sorted.map((row, rowIndex) => {
              const pid = row.player_id ? String(row.player_id) : "";
              return (
              <WeeklyTableRow
                key={rowRankKey(row)}
                row={row}
                rowIndex={rowIndex}
                rank={rankMap.get(rowRankKey(row)) ?? null}
                showOpponent={showOpponent}
                hasSentiment={hasSentiment}
                showBoost={showBoost}
                unavailableColSpan={unavailableColSpan}
                scaleMax={scaleMax}
                playerMedia={playerMedia}
                position={position}
                season={season}
                week={week}
                dvpTeamCount={dvpTeamCount}
                compareEnabled={compareEnabled}
                selected={pid ? selectedSet.has(pid) : false}
                selectDisabled={selectDisabled}
                onToggleSelect={onToggleCompare}
                whyExpanded={Boolean(pid && whyPlayerId === pid)}
                onToggleWhy={() => toggleWhy(pid)}
                whyColSpan={emptyColSpan}
                applyInjuryAdjustments={applyInjuryAdjustments}
              />
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
