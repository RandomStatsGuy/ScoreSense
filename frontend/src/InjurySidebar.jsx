import React, { useMemo } from "react";
import Chip, { injuryChipTone } from "./Chip";
import { formatRelativeTime, formatReturnEstimate, injuryDetailLine } from "./format";

const POSITION_LABELS = { qb: "QB", rb: "RB", wr: "WR/TE" };
const POSITION_PLURAL = { qb: "QBs", rb: "RBs", wr: "WR/TE" };

const SEVERITY_ORDER = {
  Out: 0,
  IR: 1,
  PUP: 2,
  Doubtful: 3,
  Questionable: 4,
};

function injuryCardClass(status) {
  const s = String(status || "").toLowerCase();
  if (/(out|ir|pup|inactive|suspended)/.test(s)) return "injury-card injury-card--severe";
  if (s.includes("doubtful")) return "injury-card injury-card--doubtful";
  if (s.includes("questionable")) return "injury-card injury-card--questionable";
  return "injury-card injury-card--default";
}

function sortInjuries(players) {
  return [...players].sort((a, b) => {
    const sa = SEVERITY_ORDER[a.injury_status] ?? 99;
    const sb = SEVERITY_ORDER[b.injury_status] ?? 99;
    if (sa !== sb) return sa - sb;
    return String(a.full_name || "").localeCompare(String(b.full_name || ""));
  });
}

export default function InjurySidebar({
  players,
  position,
  selectedTeams,
  searchQuery,
  isLiveContext,
  defaultSeason,
  defaultWeek,
  className = "",
}) {
  const sorted = useMemo(() => sortInjuries(players || []), [players]);

  const headerLine = useMemo(() => {
    const posLabel = POSITION_PLURAL[position] || POSITION_LABELS[position] || position?.toUpperCase();
    const count = sorted.length;
    const noun = count === 1 ? posLabel.replace(/s$/, "") : posLabel;
    let line = `${count} injured ${noun}`;
    if (selectedTeams?.length) {
      line += ` · ${selectedTeams.join(", ")}`;
    }
    if (searchQuery?.trim()) {
      line += ` · "${searchQuery.trim()}"`;
    }
    return line;
  }, [position, selectedTeams, searchQuery, sorted.length]);

  if (!isLiveContext) {
    const weekLabel = defaultWeek != null ? `Week ${defaultWeek}` : "the live week";
    return (
      <section className={`panel injury-sidebar projections-mobile-panel ${className}`.trim()}>
        <div className="injury-sidebar-head">
          <h2>Injuries</h2>
        </div>
        <div className="state-empty-callout sidebar-empty-callout" role="status">
          No injury data is available for this week. View {weekLabel} data for current designations.
        </div>
      </section>
    );
  }

  return (
    <section className={`panel injury-sidebar projections-mobile-panel ${className}`.trim()}>
      <div className="injury-sidebar-head">
        <div>
          <h2>Injuries</h2>
          <p className="panel-subtitle">{headerLine}</p>
        </div>
      </div>
      <div className="injury-list-scroll">
        <ul className="injury-list">
          {sorted.length === 0 && <li className="muted">No matching injuries</li>}
          {sorted.map((p) => {
            const detail = injuryDetailLine(p);
            const updated = formatRelativeTime(p.news_updated);
            const returnEst = formatReturnEstimate(p.return_estimate);
            return (
              <li key={p.sleeper_id} className={injuryCardClass(p.injury_status)}>
                <span className="injury-card-name">{p.full_name}</span>
                <span className="injury-row-meta">
                  <span className="injury-row-team">
                    {p.team} · {p.position}
                  </span>
                  <Chip tone={injuryChipTone(p.injury_status)}>{p.injury_status}</Chip>
                </span>
                {detail ? <span className="injury-detail">{detail}</span> : null}
                {returnEst ? (
                  <span
                    className="injury-return-estimate"
                    title="Heuristic from injury type and designation — not an official team report"
                  >
                    {returnEst.text}
                    {returnEst.isEstimate ? (
                      <span className="injury-return-estimate-tag">estimate</span>
                    ) : null}
                  </span>
                ) : null}
                {updated ? <span className="injury-updated">{updated}</span> : null}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
