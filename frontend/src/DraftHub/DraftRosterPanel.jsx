import React, { useEffect, useMemo, useRef, useState } from "react";
import { positionChipTone } from "./draftAuctionTheater";
import PlayerCell, { usePlayerMedia } from "../PlayerCell";
import { mergePlayerMedia } from "./draftRoomEnrichment";
import { HUB_POS_ORDER, normalizeHubPosition } from "./hubPositions";
import { fmtSal } from "./rosterFormat";

function RosterActions({
  showDrop,
  showTrade,
  cutBusy,
  actionsDisabled,
  onDrop,
  onTrade,
  playerName,
  pickDraft = false,
}) {
  if (!showDrop && !showTrade) return null;
  return (
    <span className="hub-roster-actions">
      {showDrop && (
        <button
          type="button"
          className="hub-roster-action hub-roster-action--drop"
          disabled={cutBusy || actionsDisabled}
          onClick={onDrop}
          title={pickDraft
            ? "Drop player back into the pool"
            : "Drop player back into the pool and apply cap refund"}
        >
          Drop
        </button>
      )}
      {showTrade && (
        <button
          type="button"
          className="hub-roster-action hub-roster-action--trade"
          disabled={actionsDisabled}
          onClick={onTrade}
          title={`Offer ${playerName} in a trade`}
        >
          Trade
        </button>
      )}
    </span>
  );
}

export default function DraftRosterPanel({
  viewer,
  rosterLimits,
  allowMidDraftCuts = false,
  allowTrades = false,
  onCutPlayer,
  onTradePlayer,
  cutBusy = false,
  actionsDisabled = false,
  budgetRemaining,
  maxBid = null,
  isNominator = false,
  isHighBidder = false,
  ended = false,
  pendingTradeCount = 0,
  onOpenInbox,
  pickDraft = false,
  variant = "panel",
  mediaByPlayerId = null,
}) {
  const roster = viewer?.roster || [];
  const capacity = viewer?.capacity?.by_position || {};
  const band = variant === "band";

  const playerIds = useMemo(
    () => roster.map((r) => r.player_id).filter(Boolean),
    [roster],
  );
  const fetchedMedia = usePlayerMedia(playerIds);
  const playerMedia = useMemo(
    () => mergePlayerMedia(fetchedMedia, mediaByPlayerId),
    [fetchedMedia, mediaByPlayerId],
  );

  const grouped = useMemo(() => {
    const map = {};
    for (const row of roster) {
      const pos = normalizeHubPosition(row.position || "?");
      if (!map[pos]) map[pos] = [];
      map[pos].push(row);
    }
    return map;
  }, [roster]);

  const limitRows = useMemo(() => {
    const keys = new Set([...HUB_POS_ORDER, ...Object.keys(capacity)]);
    return [...keys].filter((k) => capacity[k] || rosterLimits?.[k.toLowerCase()]);
  }, [capacity, rosterLimits]);

  const sortedRoster = useMemo(() => (
    HUB_POS_ORDER.flatMap((pos) => grouped[pos] || []).concat(
      Object.entries(grouped)
        .filter(([p]) => !HUB_POS_ORDER.includes(p))
        .flatMap(([, rows]) => rows),
    )
  ), [grouped]);

  if (!viewer) {
    return (
      <div className={`hub-roster-panel${band ? " hub-roster-panel--band" : ""}`}>
        <h3 className="hub-section-title">My roster</h3>
        <p className="chart-note">Join the league to track your draft roster here.</p>
      </div>
    );
  }

  const liveActions = !ended && (allowMidDraftCuts || allowTrades);
  const seenIds = useRef(new Set());
  const [freshIds, setFreshIds] = useState(() => new Set());
  useEffect(() => {
    const next = new Set(roster.map((row) => String(row.player_id || "")).filter(Boolean));
    const added = [...next].filter((id) => !seenIds.current.has(id));
    if (seenIds.current.size && added.length) {
      setFreshIds(new Set(added));
      const id = setTimeout(() => setFreshIds(new Set()), 200);
      seenIds.current = next;
      return () => clearTimeout(id);
    }
    seenIds.current = next;
    return undefined;
  }, [roster]);

  return (
    <div className={`hub-roster-panel${band ? " hub-roster-panel--band" : ""}`}>
      <div className="hub-roster-panel-head">
        <div className="hub-roster-panel-title">
          {band && <span className="hub-draft-experience-kicker">My team</span>}
          <h3 className="hub-section-title">{viewer.team_name || "Your team"}</h3>
          {isNominator && <span className="hub-team-tag hub-team-tag-nom">{pickDraft ? "On the clock" : "Nominates"}</span>}
          {!pickDraft && isHighBidder && <span className="hub-team-tag hub-team-tag-lead">High bid</span>}
        </div>
        {band && (
          <div className="hub-roster-panel-summary">
            <span><strong>{roster.length}</strong> players</span>
            {!pickDraft && budgetRemaining != null && (
              <span>
                <strong>{fmtSal(budgetRemaining)}</strong> left
                {maxBid != null && <> · max {fmtSal(maxBid)}</>}
              </span>
            )}
          </div>
        )}
      </div>
      {!band && !ended && !pickDraft && budgetRemaining != null && (
        <p className="chart-note hub-roster-panel-budget">
          <strong>{fmtSal(budgetRemaining)}</strong> left
          {maxBid != null && <> · max bid <strong>{fmtSal(maxBid)}</strong></>}
        </p>
      )}
      {liveActions && !band && (
        <p className="chart-note hub-draft-cut-banner">
          {allowMidDraftCuts && allowTrades
            ? "Drop returns a player to the pool. Trade opens a two-team offer."
            : allowMidDraftCuts
              ? (pickDraft
                ? "Mid-draft cuts on — drop a player back into the pool."
                : "Mid-draft cuts on — drop a player to free cap.")
              : (pickDraft
                ? "Trade a drafted player with another team."
                : "Tap Trade on a player to start an offer.")}
        </p>
      )}
      {pendingTradeCount > 0 && onOpenInbox && (
        <button
          type="button"
          className="hub-draft-trade-inbox-btn"
          disabled={actionsDisabled}
          onClick={onOpenInbox}
        >
          {pendingTradeCount} pending trade{pendingTradeCount === 1 ? "" : "s"}
        </button>
      )}
      <div className="hub-cap-grid">
        {limitRows.map((pos) => {
          const cap = capacity[pos];
          const min = Number(cap?.min ?? rosterLimits?.[pos.toLowerCase()]?.min ?? 0);
          const count = cap?.count ?? grouped[pos]?.length ?? 0;
          const max = cap?.max ?? rosterLimits?.[pos.toLowerCase()]?.max ?? "—";
          const tone = positionChipTone({
            count,
            min,
            max: max === "—" || max == null ? null : max,
          });
          const belowMin = cap?.below_min ?? (min > 0 && count < min);
          const label = min > 0 ? `${count}/${min} min · ${max} max` : `${count}/${max}`;
          return (
            <div
              key={pos}
              className={`hub-cap-chip hub-cap-chip-${tone}`}
              title={belowMin ? `Need ${min - count} ${pos}` : undefined}
            >
              <span>{pos}</span>
              <strong>{label}</strong>
            </div>
          );
        })}
      </div>
      {sortedRoster.length === 0 ? (
        !ended ? <p className="chart-note">No players yet.</p> : null
      ) : (
        <ul className="hub-roster-list">
          {sortedRoster.map((row) => (
            <li
              key={row.player_id}
              className={`hub-roster-row hub-roster-row--locker${freshIds.has(String(row.player_id)) ? " is-new" : ""}`}
            >
              <span className="hub-roster-pos">{normalizeHubPosition(row.position)}</span>
              <span className="hub-roster-name">
                <PlayerCell
                  name={row.player_name}
                  playerId={row.player_id}
                  media={playerMedia}
                  size="sm"
                  showTeam={false}
                  narrativeScope="season"
                />
              </span>
              {!pickDraft && <span className="hub-roster-sal">{fmtSal(row.salary)}</span>}
              <RosterActions
                showDrop={Boolean(allowMidDraftCuts && onCutPlayer && !ended)}
                showTrade={Boolean(allowTrades && onTradePlayer && !ended)}
                cutBusy={cutBusy}
                actionsDisabled={actionsDisabled}
                onDrop={() => onCutPlayer(row.player_id)}
                onTrade={() => onTradePlayer({
                  player_id: row.player_id,
                  player_name: row.player_name,
                  position: row.position,
                  salary: row.salary,
                  team_id: viewer.team_id,
                  mine: true,
                })}
                playerName={row.player_name}
                pickDraft={pickDraft}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
