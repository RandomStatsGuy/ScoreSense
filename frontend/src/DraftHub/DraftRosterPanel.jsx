import React, { useMemo } from "react";
import { HUB_POS_ORDER, normalizeHubPosition } from "./hubPositions";

function fmtSal(v) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return `$${Number(v).toFixed(0)}`;
}

export default function DraftRosterPanel({
  viewer,
  rosterLimits,
  allowMidDraftCuts = false,
  onCutPlayer,
  cutBusy = false,
  budgetRemaining,
  ended = false,
}) {
  const roster = viewer?.roster || [];
  const capacity = viewer?.capacity?.by_position || {};

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
      <h3 className="hub-section-title">{viewer.team_name || "Your team"}</h3>
      {allowMidDraftCuts && (
        <p className="chart-note hub-draft-cut-banner">
          Mid-draft cuts on — drop a player to free cap
          {budgetRemaining != null ? ` (${fmtSal(budgetRemaining)} left)` : ""}.
        </p>
      )}
      {!allowMidDraftCuts && !ended && (
        <p className="chart-note hub-draft-sidebar-hint">Auction roster</p>
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
              <span className="hub-roster-name">{row.player_name}</span>
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
