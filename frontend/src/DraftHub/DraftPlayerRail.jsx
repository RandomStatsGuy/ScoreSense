import React, { useMemo, useState } from "react";
import PlayerCell, { usePlayerMedia } from "../PlayerCell";
import { formatSeasonPts } from "../seasonQuantiles";
import { effectiveAuctionBid } from "../riskAdjustedValue";
import { normalizeHubPosition } from "./hubPositions";
import { fmtSal } from "./rosterFormat";
import {
  DRAFT_PLAYER_RAIL_POSITIONS,
  defaultDraftPlayerRailSort,
  draftPlayerRailRows,
} from "./draftPlayerRail.js";
import { HubFilterMenu } from "./HubUILayout";
import { mergePlayerMedia } from "./draftRoomEnrichment";
import { mockDraftLiveCopy } from "./mockDraftConfig";
import { draftPoolWhy, rangeBarCopy, showPoolNeedChip } from "./draftPoolWhy";
import {
  draftLiveCopy,
  nominateDisabledReason,
  poolRowIsPrimary,
  poolSearchPlaceholder,
  watchLabel,
} from "./draftLivePresentation";

const PICK_SORTS = [
  ["season_proj", "Projection"],
  ["season_p90", "Ceiling"],
  ["player", "Name"],
];

const AUCTION_SORTS = [
  ["fair_value", "Suggested bid"],
  ["season_proj", "Projection"],
  ["player", "Name"],
];

function secondaryMetric(row, pickDraft) {
  const ppg = Number(row?.per_game_proj);
  const base = Number.isFinite(ppg) ? `${ppg.toFixed(1)}/g` : null;
  if (pickDraft) {
    const position = normalizeHubPosition(row?.position);
    const rank = row?.pos_rank != null ? `${position}${row.pos_rank}` : null;
    return [rank, base].filter(Boolean).join(" · ") || "Season projection";
  }
  const lo = row?.min_sal;
  const hi = row?.max_sal;
  const range = lo != null && hi != null ? `${fmtSal(lo)}–${fmtSal(hi)}` : null;
  return [range, base].filter(Boolean).join(" · ") || "Auction value";
}

export default function DraftPlayerRail({
  rows = [],
  loading = false,
  pickDraft = false,
  needPositions = [],
  mediaByPlayerId = null,
  onSelectPlayer,
  onDraftPlayer,
  onQueuePlayer,
  onWatchPlayer,
  watchIds = [],
  canDraft = false,
  showDraftAction = false,
  actionsDisabled = false,
  actionLabel,
  minBid = 1,
  riskTolerance = 0,
  rules = null,
  wideStage = false,
  rosterCount = 0,
  paused = false,
  nominatorName = "",
}) {
  const [search, setSearch] = useState("");
  const [position, setPosition] = useState("ALL");
  const [sortKey, setSortKey] = useState(() => defaultDraftPlayerRailSort(pickDraft));
  const [needsOnly, setNeedsOnly] = useState(false);
  const visibleRows = useMemo(
    () => draftPlayerRailRows(rows, {
      pickDraft,
      position,
      search,
      sortKey,
      needsOnly,
      needPositions,
      maxRows: 60,
    }),
    [rows, pickDraft, position, search, sortKey, needsOnly, needPositions],
  );
  const fetchedMedia = usePlayerMedia(visibleRows.map((row) => row.player_id).filter(Boolean));
  const media = useMemo(
    () => mergePlayerMedia(fetchedMedia, mediaByPlayerId),
    [fetchedMedia, mediaByPlayerId],
  );
  const watched = useMemo(() => new Set((watchIds || []).map(String)), [watchIds]);
  const needs = useMemo(
    () => new Set((needPositions || []).map(normalizeHubPosition)),
    [needPositions],
  );
  const sorts = pickDraft ? PICK_SORTS : AUCTION_SORTS;
  const poolCopy = mockDraftLiveCopy();
  const searchPlaceholder = poolSearchPlaceholder({ canDraft, pickDraft });
  const lockedReason = nominateDisabledReason({
    paused,
    canDraft,
    nominatorName,
  });
  const primaryRowId = String(selectedPlayerId || visibleRows[0]?.player_id || "");

  return (
    <section className={`hub-draft-player-rail${wideStage ? " hub-draft-player-rail--stage" : ""}`} aria-label={poolCopy.playerPoolLabel}>
      <header className="hub-draft-player-rail-head">
        <div>
          <span className="hub-draft-experience-kicker">{poolCopy.playerPoolLabel}</span>
        </div>
        <span className="hub-draft-player-count">{rows.length}</span>
      </header>

      <label className="hub-draft-player-search">
        <span className="sr-only">{poolCopy.playerPoolSearch}</span>
        <input
          type="search"
          value={search}
          placeholder={searchPlaceholder}
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>

      <div className="hub-draft-player-filters" aria-label="Filter by position">
        {DRAFT_PLAYER_RAIL_POSITIONS.map((pos) => (
          <button
            key={pos}
            type="button"
            className={position === pos ? "is-active" : ""}
            aria-pressed={position === pos}
            onClick={() => setPosition(pos)}
          >
            {pos}
          </button>
        ))}
      </div>

      <div className="hub-draft-player-rail-tools">
        <button
          type="button"
          className={`hub-draft-needs-toggle${needsOnly ? " is-active" : ""}`}
          aria-pressed={needsOnly}
          disabled={!needPositions.length}
          onClick={() => setNeedsOnly((value) => !value)}
        >
          {needPositions.length ? `Needs · ${needPositions.join(" ")}` : "Needs filled"}
        </button>
        <HubFilterMenu
          label="Sort"
          value={sortKey}
          options={sorts.map(([id, label]) => ({ id, label }))}
          onChange={setSortKey}
        />
      </div>

      <div className="hub-draft-player-list" role="list" aria-label="Draftable players">
        {loading && visibleRows.length === 0 ? (
          <p className="chart-note hub-draft-player-empty">Loading players…</p>
        ) : visibleRows.length === 0 ? (
          <p className="chart-note hub-draft-player-empty">No players match these filters.</p>
        ) : visibleRows.map((row) => {
          const id = String(row.player_id || "");
          const selected = id && id === String(selectedPlayerId || "");
          const isNeed = needs.has(normalizeHubPosition(row.position));
          const auctionValue = effectiveAuctionBid(row, riskTolerance, rules)
            ?? row.fair_value
            ?? row.model_bid_hint;
          const primary = pickDraft
            ? `${formatSeasonPts(row.season_p50 ?? row.season_proj, 0)} pts`
            : fmtSal(auctionValue);
          const whyBar = wideStage && !pickDraft
            ? rangeBarCopy(row.min_sal, auctionValue, row.max_sal)
            : null;
          const showNeed = showPoolNeedChip({ isNeed, rosterCount });
          const watching = watched.has(id);
          const rowPrimary = poolRowIsPrimary({
            playerId: id,
            primaryRowId,
            canDraft,
          });
          return (
            <article
              key={id || `${row.player || row.player_name}-${row.position}`}
              className={`hub-draft-player-card${selected ? " is-selected" : ""}`}
              role="listitem"
            >
              <button
                type="button"
                className="hub-draft-player-card-select"
                aria-pressed={selected}
                onClick={() => onSelectPlayer?.(row)}
                onDoubleClick={() => !actionsDisabled && canDraft && onDraftPlayer?.(row)}
              >
                <PlayerCell
                  name={row.player || row.player_name}
                  team={row.team}
                  position={normalizeHubPosition(row.position)}
                  playerId={row.player_id}
                  media={media}
                  size="sm"
                  narrativeScope="season"
                />
                {wideStage && !pickDraft && (
                  <span className="hub-draft-player-why">
                    {whyBar ? (
                      <span className="hub-draft-range-copy">
                        {draftLiveCopy.floor} {whyBar.floor}
                        {" · "}
                        {draftLiveCopy.suggested} {whyBar.suggested || primary}
                        {" · "}
                        {draftLiveCopy.ceiling} {whyBar.ceiling}
                      </span>
                    ) : (
                      <span>{draftPoolWhy(row, { isNeed, rosterCount })}</span>
                    )}
                  </span>
                )}
                <span className="hub-draft-player-metric">
                  <strong>{primary}</strong>
                  <span>{pickDraft ? secondaryMetric(row, pickDraft) : draftLiveCopy.suggested}</span>
                </span>
              </button>
              <div className="hub-draft-player-card-actions">
                {showNeed ? <span className="hub-draft-player-need">Need</span> : <span />}
                {showDraftAction && (
                  <span
                    className="hub-draft-player-draft-tip"
                    title={!canDraft ? lockedReason : undefined}
                  >
                    <button
                      type="button"
                      className={rowPrimary ? "btn-primary btn-sm" : "btn-ghost btn-sm"}
                      disabled={actionsDisabled || !canDraft}
                      onClick={() => onDraftPlayer?.(row)}
                    >
                      {actionLabel || (pickDraft ? draftLiveCopy.pick : draftLiveCopy.nominate)}
                    </button>
                  </span>
                )}
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  disabled={actionsDisabled}
                  onClick={() => onQueuePlayer?.(row)}
                >
                  {draftLiveCopy.queue}
                </button>
                <button
                  type="button"
                  className={`hub-draft-player-watch${watching ? " is-watching" : ""}`}
                  aria-label={watching
                    ? `Remove ${row.player || row.player_name} from watch list`
                    : `Watch ${row.player || row.player_name}`}
                  aria-pressed={watching}
                  onClick={() => onWatchPlayer?.(row)}
                >
                  <span aria-hidden="true">{watching ? "★" : "☆"}</span>
                  {watchLabel(watching)}
                </button>
              </div>
            </article>
          );
        })}
      </div>
      {visibleRows.length < rows.length && (
        <p className="chart-note hub-draft-player-rail-foot">Top {visibleRows.length} shown · search to find anyone</p>
      )}
    </section>
  );
}
