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

/** Compact status label for the narrow sidebar; full status stays in title/aria. */
function injuryStatusShort(status) {
  const s = String(status || "").trim();
  const lower = s.toLowerCase();
  if (lower.includes("questionable")) return "Q";
  if (lower.includes("doubtful")) return "D";
  if (lower.includes("probable")) return "P";
  if (/(^|\s)out(\s|$)/i.test(s)) return "Out";
  if (/\bir\b/i.test(s)) return "IR";
  if (/\bpup\b/i.test(s)) return "PUP";
  return s.length > 8 ? `${s.slice(0, 7)}…` : s;
}

function compactReturnLabel(returnEst) {
  if (!returnEst?.text) return null;
  // "Est. return: 1-3 weeks" → "1–3 wk"
  let label = String(returnEst.text).replace(/^Est\.\s*return:\s*/i, "").trim();
  label = label
    .replace(/\bweeks?\b/gi, "wk")
    .replace(/\bdays?\b/gi, "d")
    .replace(/\s*-\s*/g, "–");
  return label;
}

function compactUpdated(updated) {
  if (!updated) return null;
  return String(updated).replace(/^Updated\s+/i, "");
}

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
            const updated = compactUpdated(formatRelativeTime(p.news_updated));
            const returnEst = formatReturnEstimate(p.return_estimate);
            const returnLabel = compactReturnLabel(returnEst);
            const statusShort = injuryStatusShort(p.injury_status);
            const metaBits = [
              p.team,
              detail,
              returnLabel,
              updated,
            ].filter(Boolean);

            return (
              <li key={p.sleeper_id} className={injuryCardClass(p.injury_status)}>
                <div className="injury-card-top">
                  <span className="injury-card-name" title={p.full_name}>
                    {p.full_name}
                  </span>
                  {p.injury_status ? (
                    <Chip
                      tone={injuryChipTone(p.injury_status)}
                      className="injury-status-chip"
                      title={p.injury_status}
                      aria-label={`Injury status: ${p.injury_status}`}
                    >
                      {statusShort}
                    </Chip>
                  ) : null}
                </div>
                {metaBits.length ? (
                  <p className="injury-card-meta" title={metaBits.join(" · ")}>
                    {metaBits.join(" · ")}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
