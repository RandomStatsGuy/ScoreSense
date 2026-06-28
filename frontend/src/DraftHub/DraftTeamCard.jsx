import React, { useMemo, useState } from "react";
import { HUB_POS_ORDER, normalizeHubPosition } from "./hubPositions";

function fmtSal(v) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return `$${Number(v).toFixed(0)}`;
}

export default function DraftTeamCard({
  team,
  roster = [],
  cap,
  isLeader,
  isNominator,
  isViewer,
  defaultOpen = false,
  rosterLimits,
}) {
  const [open, setOpen] = useState(defaultOpen);
  const spent = cap - Number(team.budget_remaining ?? cap);

  const grouped = useMemo(() => {
    const map = {};
    for (const row of roster) {
      const pos = normalizeHubPosition(row.position || "?");
      if (!map[pos]) map[pos] = [];
      map[pos].push(row);
    }
    return map;
  }, [roster]);

  const posSummary = useMemo(() => {
    return HUB_POS_ORDER.map((pos) => {
      const count = grouped[pos]?.length ?? 0;
      const max = rosterLimits?.[pos.toLowerCase()]?.max;
      return { pos, count, max };
    }).filter((row) => row.count > 0 || row.max);
  }, [grouped, rosterLimits]);

  const rosterPreview = useMemo(() => {
    const ordered = HUB_POS_ORDER.flatMap((pos) => grouped[pos] || []).concat(
      Object.entries(grouped)
        .filter(([p]) => !HUB_POS_ORDER.includes(p))
        .flatMap(([, rows]) => rows),
    );
    return ordered.slice(0, 4);
  }, [grouped]);

  return (
    <div
      className={`hub-team-card hub-team-card-expandable${isLeader ? " hub-team-leading" : ""}${team.is_bot ? " hub-team-bot" : ""}${isNominator ? " hub-team-nominating" : ""}${isViewer ? " hub-team-viewer" : ""}${open ? " hub-team-card-open" : ""}`}
    >
      <button type="button" className="hub-team-card-toggle" onClick={() => setOpen((v) => !v)}>
        <div className="hub-team-card-head">
          <strong>{team.name}</strong>
          <span className="hub-team-card-tags">
            {team.is_commissioner ? <span className="hub-team-tag">Commish</span> : null}
            {team.is_bot ? <span className="hub-team-tag">Bot</span> : null}
            {isNominator ? <span className="hub-team-tag hub-team-tag-nom">Nominate</span> : null}
            {isLeader ? <span className="hub-team-tag hub-team-tag-lead">High bid</span> : null}
          </span>
        </div>
        <div className="hub-team-budget">
          <span>{fmtSal(team.budget_remaining)} left</span>
          <span className="chart-note">{fmtSal(spent)} spent · {roster.length} players</span>
        </div>
        {posSummary.length > 0 && (
          <div className="hub-team-pos-summary">
            {posSummary.map(({ pos, count, max }) => (
              <span key={pos} className="hub-team-pos-pill">{pos} {count}{max ? `/${max}` : ""}</span>
            ))}
          </div>
        )}
        {!open && rosterPreview.length > 0 && (
          <ul className="hub-team-roster-preview">
            {rosterPreview.map((row) => (
              <li key={row.player_id}>
                <span className="hub-roster-pos">{row.position}</span>
                <span className="hub-roster-name">{row.player_name}</span>
                <span className="hub-roster-sal">{fmtSal(row.salary)}</span>
              </li>
            ))}
            {roster.length > rosterPreview.length && (
              <li className="hub-team-roster-more">+{roster.length - rosterPreview.length} more</li>
            )}
          </ul>
        )}
        <div className="hub-budget-bar">
          <div className="hub-budget-fill" style={{ width: `${Math.min(100, (spent / cap) * 100)}%` }} />
        </div>
      </button>
      {open && (
        <div className="hub-team-roster-detail">
          {roster.length === 0 ? (
            <p className="chart-note">No players drafted yet.</p>
          ) : (
            <ul className="hub-roster-list">
              {HUB_POS_ORDER.flatMap((pos) => grouped[pos] || []).concat(
                Object.entries(grouped)
                  .filter(([p]) => !HUB_POS_ORDER.includes(p))
                  .flatMap(([, rows]) => rows),
              ).map((row) => (
                <li key={row.player_id} className="hub-roster-row">
                  <span className="hub-roster-pos">{row.position}</span>
                  <span className="hub-roster-name">{row.player_name}</span>
                  <span className="hub-roster-sal">{fmtSal(row.salary)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
