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
import { mergePlayerMedia } from "./draftRoomEnrichment";

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
  selectedPlayerId = "",
  mediaByPlayerId = null,
  onSelectPlayer,
  onDraftPlayer,
  onQueuePlayer,
  onWatchPlayer,
  watchIds = [],
  canDraft = false,
  actionsDisabled = false,
  actionLabel,
  minBid = 1,
  riskTolerance = 0,
  rules = null,
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

  return (
    <section className="hub-draft-player-rail" aria-label="Available players">
      <header className="hub-draft-player-rail-head">
        <div>
          <span className="hub-draft-experience-kicker">Player pool</span>
          <h2>Available players</h2>
        </div>
        <span className="hub-draft-player-count">{rows.length}</span>
      </header>

      <label className="hub-draft-player-search">
        <span className="sr-only">Search available players</span>
        <input
          type="search"
          value={search}
          placeholder="Search player or team"
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
        <label>
          <span className="sr-only">Sort available players</span>
          <select value={sortKey} onChange={(event) => setSortKey(event.target.value)}>
            {sorts.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label>
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
                <span className="hub-draft-player-metric">
                  <strong>{primary}</strong>
                  <span>{secondaryMetric(row, pickDraft)}</span>
                </span>
              </button>
              <div className="hub-draft-player-card-actions">
                {isNeed ? <span className="hub-draft-player-need">Need</span> : <span />}
                {canDraft && (
                  <button
                    type="button"
                    className="btn-primary btn-sm"
                    disabled={actionsDisabled}
                    onClick={() => onDraftPlayer?.(row)}
                  >
                    {actionLabel || (pickDraft ? "Pick" : `Nominate ${fmtSal(minBid)}`)}
                  </button>
                )}
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  disabled={actionsDisabled}
                  onClick={() => onQueuePlayer?.(row)}
                >
                  Queue
                </button>
                <button
                  type="button"
                  className="hub-draft-player-watch"
                  aria-label={watched.has(id) ? `Remove ${row.player || row.player_name} from watch list` : `Watch ${row.player || row.player_name}`}
                  aria-pressed={watched.has(id)}
                  onClick={() => onWatchPlayer?.(row)}
                >
                  {watched.has(id) ? "★" : "☆"}
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
