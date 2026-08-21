import React, { useMemo } from "react";
import PlayerCell, { usePlayerMedia } from "../PlayerCell";
import { HUB_POS_ORDER, normalizeHubPosition } from "./hubPositions";
import { fmtSal } from "./rosterFormat";

function RosterActions({ showDrop, showTrade, cutBusy, onDrop, onTrade, playerName }) {
  if (!showDrop && !showTrade) return null;
  return (
    <span className="hub-roster-actions">
      {showDrop && (
        <button
          type="button"
          className="hub-roster-action hub-roster-action--drop"
          disabled={cutBusy}
          onClick={onDrop}
          title="Drop player back into the pool and apply cap refund"
        >
          Drop
        </button>
      )}
      {showTrade && (
        <button
          type="button"
          className="hub-roster-action hub-roster-action--trade"
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
  budgetRemaining,
  maxBid = null,
  isNominator = false,
  isHighBidder = false,
  ended = false,
  pendingTradeCount = 0,
  onOpenInbox,
}) {
  const roster = viewer?.roster || [];
  const capacity = viewer?.capacity?.by_position || {};

  const playerIds = useMemo(
    () => roster.map((r) => r.player_id).filter(Boolean),
    [roster],
  );
  const playerMedia = usePlayerMedia(playerIds);

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
      <div className="hub-roster-panel">
        <h3 className="hub-section-title">My roster</h3>
        <p className="chart-note">Join the league to track your draft roster here.</p>
      </div>
    );
  }

  const liveActions = !ended && (allowMidDraftCuts || allowTrades);

  return (
    <div className="hub-roster-panel">
      <div className="hub-roster-panel-head">
        <h3 className="hub-section-title">{viewer.team_name || "Your team"}</h3>
        {isNominator && <span className="hub-team-tag hub-team-tag-nom">Nominates</span>}
        {isHighBidder && <span className="hub-team-tag hub-team-tag-lead">High bid</span>}
      </div>
      {!ended && budgetRemaining != null && (
        <p className="chart-note hub-roster-panel-budget">
          <strong>{fmtSal(budgetRemaining)}</strong> left
          {maxBid != null && <> · max bid <strong>{fmtSal(maxBid)}</strong></>}
        </p>
      )}
      {liveActions && (
        <p className="chart-note hub-draft-cut-banner">
          {allowMidDraftCuts && allowTrades
            ? "Drop returns a player to the pool. Trade opens a two-team offer."
            : allowMidDraftCuts
              ? "Mid-draft cuts on — drop a player to free cap."
              : "Tap Trade on a player to start an offer."}
        </p>
      )}
      {pendingTradeCount > 0 && onOpenInbox && (
        <button
          type="button"
          className="hub-draft-trade-inbox-btn"
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
          const atMax = cap?.at_max;
          const belowMin = cap?.below_min ?? (min > 0 && count < min);
          const label = min > 0 ? `${count}/${min} min · ${max} max` : `${count}/${max}`;
          return (
            <div
              key={pos}
              className={`hub-cap-chip${atMax ? " hub-cap-chip-full" : ""}${belowMin ? " hub-cap-chip-need" : ""}`}
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
            <li key={row.player_id} className="hub-roster-row">
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
              <span className="hub-roster-sal">{fmtSal(row.salary)}</span>
              <RosterActions
                showDrop={Boolean(allowMidDraftCuts && onCutPlayer && !ended)}
                showTrade={Boolean(allowTrades && onTradePlayer && !ended)}
                cutBusy={cutBusy}
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
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
