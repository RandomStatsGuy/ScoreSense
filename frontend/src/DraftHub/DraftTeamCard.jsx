import React, { useMemo, useState } from "react";
import { HUB_POS_ORDER, normalizeHubPosition } from "./hubPositions";
import { isRetainedThroughDraft } from "./draftRoomHelpers";
import { fmtSal } from "./rosterFormat";

export default function DraftTeamCard({
  team,
  roster = [],
  cap,
  isLeader,
  isNominator,
  isViewer,
  defaultOpen = false,
  rosterLimits,
  draftCompleted = false,
  allowTrades = false,
  onTradePlayer,
}) {
  const [open, setOpen] = useState(defaultOpen);
  const spent = cap - Number(team.budget_remaining ?? cap);

  const occupying = useMemo(
    () => (roster || []).filter((row) => isRetainedThroughDraft(row, draftCompleted)),
    [roster, draftCompleted],
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

  const occupyCounts = useMemo(() => {
    const counts = {};
    for (const row of occupying) {
      const pos = normalizeHubPosition(row.position || "?");
      counts[pos] = (counts[pos] || 0) + 1;
    }
    return counts;
  }, [occupying]);

  const posSummary = useMemo(() => {
    return HUB_POS_ORDER.map((pos) => {
      const count = occupyCounts[pos] || 0;
      const lim = rosterLimits?.[pos.toLowerCase()] || {};
      const max = lim.max;
      const min = Number(lim.min ?? 0);
      const need = Math.max(0, min - count);
      return { pos, count, max, min, need };
    }).filter((row) => row.count > 0 || row.max || row.need);
  }, [occupyCounts, rosterLimits]);

  const orderedRoster = useMemo(
    () =>
      HUB_POS_ORDER.flatMap((pos) => grouped[pos] || []).concat(
        Object.entries(grouped)
          .filter(([p]) => !HUB_POS_ORDER.includes(p))
          .flatMap(([, rows]) => rows),
      ),
    [grouped],
  );

  return (
    <div
      className={`hub-team-card hub-team-card-expandable${isLeader ? " hub-team-leading" : ""}${team.is_bot ? " hub-team-bot" : ""}${isNominator ? " hub-team-nominating" : ""}${isViewer ? " hub-team-viewer" : ""}${open ? " hub-team-card-open" : ""}`}
    >
      <button type="button" className="hub-team-card-toggle" onClick={() => setOpen((v) => !v)}>
        <div className="hub-team-card-head">
          <strong className="hub-team-card-name">{team.name}</strong>
          <span className="hub-team-card-tags">
            {isNominator ? <span className="hub-team-tag hub-team-tag-nom">Nominate</span> : null}
            {isLeader ? <span className="hub-team-tag hub-team-tag-lead">High bid</span> : null}
          </span>
          <span className="hub-team-card-meta">
            {fmtSal(team.budget_remaining)}
            <span className="chart-note"> · {occupying.length}</span>
          </span>
        </div>
        <div className="hub-budget-bar">
          <div className="hub-budget-fill" style={{ width: `${Math.min(100, (spent / cap) * 100)}%` }} />
        </div>
      </button>
      {open && (
        <div className="hub-team-roster-detail">
          <p className="chart-note hub-team-detail-meta">
            {fmtSal(team.budget_remaining)} left · {fmtSal(spent)} spent · {occupying.length} players
            {team.is_commissioner ? " · Commish" : ""}
            {team.is_bot ? " · Bot" : ""}
          </p>
          {posSummary.length > 0 && (
            <div className="hub-team-pos-summary">
              {posSummary.map(({ pos, count, max, min, need }) => (
                <span
                  key={pos}
                  className={`hub-team-pos-pill${need ? " hub-team-pos-need" : ""}`}
                >
                  {need
                    ? `Need ${pos} · ${count}/${min}`
                    : `${pos} ${count}${max ? `/${max}` : ""}`}
                </span>
              ))}
            </div>
          )}
          {roster.length === 0 ? (
            <p className="chart-note">No players drafted yet.</p>
          ) : (
            <ul className="hub-roster-list">
              {orderedRoster.map((row) => (
                <li key={row.player_id} className="hub-roster-row">
                  <span className="hub-roster-pos">{row.position}</span>
                  <span className="hub-roster-name">{row.player_name}</span>
                  <span className="hub-roster-sal">{fmtSal(row.salary)}</span>
                  {allowTrades && onTradePlayer && !isViewer && (
                    <span className="hub-roster-actions">
                      <button
                        type="button"
                        className="hub-roster-action hub-roster-action--trade"
                        onClick={() => onTradePlayer({
                          player_id: row.player_id,
                          player_name: row.player_name,
                          position: row.position,
                          salary: row.salary,
                          team_id: team.id,
                          mine: false,
                        })}
                        title={`Trade for ${row.player_name}`}
                      >
                        Trade
                      </button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
