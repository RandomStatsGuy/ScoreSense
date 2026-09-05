import React from "react";
import { HubFilterChip, HubFilterScroll } from "../HubUILayout";
import {
  POS_COLORS,
  formatSpendValue,
  managerLabel,
  rankShowsTeam,
} from "./insightsPresentation";

export function InsightsAwardCard({ award, ownerMap, yearSpecific, featured = false }) {
  const who = managerLabel(award, ownerMap, yearSpecific);
  return (
    <article
      className={`hub-insights-talk-card hub-insights-talk-card--${award.tone || "neutral"}${featured ? " is-featured" : ""}`}
    >
      <div className="hub-insights-talk-card-top">
        <span className={`hub-insights-talk-tone hub-insights-talk-tone--${award.tone || "neutral"}`} aria-hidden />
        <span className="hub-insights-talk-kicker">{award.title}</span>
      </div>
      <strong className="hub-insights-talk-headline">{award.headline}</strong>
      {(award.player_name || who) && (
        <p className="hub-insights-talk-who">
          {award.player_name && <span className="hub-insights-talk-player">{award.player_name}</span>}
          {award.player_name && who && <span className="hub-insights-talk-sep">·</span>}
          {who && <span className="hub-insights-talk-team">{who}</span>}
          {award.position && <span className="hub-insights-talk-pos">{award.position}</span>}
        </p>
      )}
      {award.detail && <p className="hub-insights-talk-detail">{award.detail}</p>}
    </article>
  );
}

export function FeaturedAwards({
  awards,
  ownerMap,
  yearSpecific,
  title = "Awards",
  subtitle,
}) {
  if (!awards?.length) return null;
  return (
    <section className="hub-insights-talk" aria-label={title}>
      <div className="hub-insights-talk-head">
        <h3>{title}</h3>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      <div className="hub-insights-talk-grid">
        {awards.map((award) => (
          <InsightsAwardCard
            key={award.id}
            award={award}
            ownerMap={ownerMap}
            yearSpecific={yearSpecific}
            featured
          />
        ))}
      </div>
    </section>
  );
}

export function MoreAwards({
  awards,
  ownerMap,
  yearSpecific,
  visibleGroups,
  onToggleGroup,
}) {
  if (!awards?.length) return null;
  const groups = [
    { key: "good", label: "Best of", items: awards.filter((a) => a.tone === "good" || a.tone === "gold") },
    { key: "bad", label: "Worst of", items: awards.filter((a) => a.tone === "bad") },
    { key: "other", label: "Notable", items: awards.filter((a) => !["bad", "good", "gold"].includes(a.tone)) },
  ].filter((g) => g.items.length > 0);

  return (
    <div className="hub-insights-more-awards">
      <div className="hub-insights-more-awards-toggles">
        <span className="hub-filter-label">Show</span>
        <HubFilterScroll>
          {groups.map(({ key, label, items }) => (
            <HubFilterChip
              key={key}
              active={visibleGroups[key]}
              onClick={() => onToggleGroup(key)}
            >
              {label} ({items.length})
            </HubFilterChip>
          ))}
        </HubFilterScroll>
      </div>
      {groups.map(({ key, label, items }) => (
        visibleGroups[key] ? (
          <div className="hub-insights-more-awards-block" key={key}>
            <span className={`hub-insights-more-awards-label hub-insights-more-awards-label--${key}`}>{label}</span>
            <div className="hub-insights-talk-grid hub-insights-talk-grid--compact">
              {items.map((award) => (
                <InsightsAwardCard
                  key={award.id}
                  award={award}
                  ownerMap={ownerMap}
                  yearSpecific={yearSpecific}
                />
              ))}
            </div>
          </div>
        ) : null
      ))}
    </div>
  );
}

export function RankBars({
  rows,
  color,
  formatValue,
  mineId,
  mineName,
  empty = "No data yet.",
}) {
  if (!rows?.length) {
    return <p className="chart-note">{empty}</p>;
  }
  return (
    <ol className="hub-insights-rank-list">
      {rows.map((row) => {
        const mine = (mineId && String(row.teamId) === String(mineId))
          || (mineName && String(row.teamName) === String(mineName));
        return (
          <li
            key={row.teamId || row.teamName || row.label}
            className={`hub-insights-rank-row${mine ? " is-mine" : ""}`}
          >
            <span className="hub-insights-rank-place">{row.rank || ""}</span>
            <span className="hub-insights-rank-name">
              {row.label}
              {rankShowsTeam(row) ? (
                <span className="hub-insights-rank-team">{row.teamName}</span>
              ) : null}
            </span>
            <div className="hub-insights-rank-track" aria-hidden>
              <div
                className="hub-insights-rank-fill"
                style={{
                  width: `${Math.max(row.pctOfLeader || 0, 4)}%`,
                  background: color,
                }}
              />
            </div>
            <span className="hub-insights-rank-value">{formatValue(row)}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function PositionSpendBoard({
  leaders,
  focusedPos,
  onFocus,
  metric,
  mineId,
  mineName,
  allTime = false,
}) {
  if (!leaders?.length) return null;
  const active = leaders.find((row) => row.position === focusedPos) || leaders[0];
  const mode = metric === "pct" ? "pct" : "dollars";
  return (
    <section className="hub-insights-board" aria-label="Position spend">
      <div className="hub-insights-talk-head">
        <h3>{allTime ? "Who spends the cap?" : "Who went heavy?"}</h3>
        <p>
          {active?.leader
            ? `${active.leader.label} leads ${active.position} by ${formatSpendValue(active.gap, mode)}.`
            : allTime
              ? "Average share of each season's cap."
              : "Tap a position to see the spend race."}
        </p>
      </div>
      <div className="hub-insights-pos-kings" role="list">
        {leaders.map((row) => {
          const selected = row.position === active.position;
          return (
            <button
              key={row.position}
              type="button"
              role="listitem"
              className={`hub-insights-pos-king${selected ? " is-selected" : ""}`}
              onClick={() => onFocus(row.position)}
              aria-pressed={selected}
              style={{ "--pos-accent": POS_COLORS[row.position] || "#64748b" }}
            >
              <span className="hub-insights-pos-king-pos">{row.position}</span>
              <strong>{row.leader?.label || "—"}</strong>
              <span className="hub-insights-pos-king-val">
                {formatSpendValue(row.max, mode)}
              </span>
            </button>
          );
        })}
      </div>
      {active && (
        <RankBars
          rows={active.ranked.map((row, idx) => ({ ...row, rank: idx + 1 }))}
          color={POS_COLORS[active.position] || "#64748b"}
          formatValue={(row) => formatSpendValue(row.value, mode)}
          mineId={mineId}
          mineName={mineName}
        />
      )}
    </section>
  );
}

export function ScoringRace({
  rows,
  mineId,
  mineName,
  onHover,
  hoveredName,
  hiddenTeams,
  onToggleTeam,
}) {
  if (!rows?.length) return null;
  return (
    <section className="hub-insights-board" aria-label="Scoring race">
      <div className="hub-insights-talk-head">
        <h3>The race</h3>
        <p>
          {rows[1]
            ? `${rows[0].label} leads ${rows[1].label} by ${rows[1].gapFromFirst} pts.`
            : `${rows[0].label} is out in front.`}
        </p>
      </div>
      <ol className="hub-insights-rank-list">
        {rows.map((row) => {
          const hidden = hiddenTeams?.has(row.teamName);
          const mine = (mineId && String(row.teamId) === String(mineId))
            || (mineName && String(row.teamName) === String(mineName));
          const hovered = hoveredName && hoveredName === row.teamName;
          return (
            <li key={row.teamName || row.label}>
              <button
                type="button"
                className={`hub-insights-rank-row hub-insights-rank-row--button${mine ? " is-mine" : ""}${hidden ? " is-hidden" : ""}${hovered ? " is-hovered" : ""}`}
                onClick={() => onToggleTeam?.(row.teamName)}
                onMouseEnter={() => onHover?.(row.teamName)}
                onMouseLeave={() => onHover?.("")}
              >
                <span className="hub-insights-rank-place">#{row.rank}</span>
                <span className="hub-insights-rank-name">
                  {row.label}
                  {rankShowsTeam(row) ? (
                    <span className="hub-insights-rank-team">{row.teamName}</span>
                  ) : null}
                </span>
                <div className="hub-insights-rank-track" aria-hidden>
                  <div
                    className="hub-insights-rank-fill"
                    style={{ width: `${Math.max(row.pctOfLeader || 0, 4)}%` }}
                  />
                </div>
                <span className="hub-insights-rank-value">
                  {row.total}
                  {row.gapFromFirst > 0 ? (
                    <span className="hub-insights-rank-gap">−{row.gapFromFirst}</span>
                  ) : (
                    <span className="hub-insights-rank-gap">lead</span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function InsightsDisclosure({ summary, meta, children, onOpen, open }) {
  return (
    <details
      className="hub-insights-disclosure"
      open={open}
      onToggle={(event) => {
        if (event.currentTarget.open) onOpen?.();
      }}
    >
      <summary className="hub-insights-disclosure-summary">
        {summary}
        {meta ? <span className="table-meta">{meta}</span> : null}
      </summary>
      <div className="hub-insights-disclosure-body">{children}</div>
    </details>
  );
}
