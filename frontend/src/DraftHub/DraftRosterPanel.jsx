import React, { useMemo } from "react";
import PlayerCell, { usePlayerMedia } from "../PlayerCell";
import { HUB_POS_ORDER, normalizeHubPosition } from "./hubPositions";
import { fmtSal } from "./rosterFormat";

export default function DraftRosterPanel({
  viewer,
  rosterLimits,
  allowMidDraftCuts = false,
  onCutPlayer,
  cutBusy = false,
  budgetRemaining,
  maxBid = null,
  isNominator = false,
  isHighBidder = false,
  ended = false,
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
      {allowMidDraftCuts && !ended && (
        <p className="chart-note hub-draft-cut-banner">
          Mid-draft cuts on — drop a player to free cap.
        </p>
      )}
      <div className="hub-cap-grid">
        {limitRows.map((pos) => {
          const cap = capacity[pos];
          const count = cap?.count ?? grouped[pos]?.length ?? 0;
          const max = cap?.max ?? rosterLimits?.[pos.toLowerCase()]?.max ?? "—";
          const atMax = cap?.at_max;
          return (
            <div key={pos} className={`hub-cap-chip${atMax ? " hub-cap-chip-full" : ""}`}>
              <span>{pos}</span>
              <strong>{count}/{max}</strong>
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
              {allowMidDraftCuts && onCutPlayer && (
                <button
                  type="button"
                  className="btn-ghost btn-sm hub-roster-cut-btn"
                  disabled={cutBusy}
                  onClick={() => onCutPlayer(row.player_id)}
                  title="Drop player and apply cap refund"
                >
                  Drop
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
