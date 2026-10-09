import React, { useState } from "react";
import useMobileLayout from "../../useMobileLayout";
import { HubFilterChip, HubFilterMenu } from "../HubUILayout";
import { formatPoints, formatSpendValue, insightsIdentityParts, INSIGHTS_COPY, metricValue, POS_COLORS, scoringSummary, scoringTeamKey, spendComparisonRows } from "./insightsPresentation";

export function InsightsIdentity({ row, ownerMap, yearSpecific, children }) {
  const { primary, secondary } = insightsIdentityParts(row, ownerMap, yearSpecific);
  return <div className="hub-insights-board-identity"><strong>{primary}</strong>{secondary && <span>{secondary}</span>}{children}</div>;
}

function SmallScoringAwards({ summary, ownerMap, yearSpecific, awards }) {
  const copy = INSIGHTS_COPY.scoring;
  const cards = [
    { label: awards?.find(award => award.id === "weekly_nuke")?.title || copy.bestWeek, row: summary.bestWeek, value: summary.bestWeek?.points },
    { label: copy.highestAverage, row: summary.highestAverage, value: summary.highestAverage?.avg_points },
    { label: copy.leagueAverage, value: summary.leagueAverage },
  ];
  return <div className="hub-insights-support-awards">{cards.map(card => <article className="hub-insights-board-panel hub-insights-support-award" key={card.label}>
    <h3 className="hub-insights-board-kicker">{card.label}</h3>
    <strong className="hub-insights-support-value">{card.value == null ? "—" : `${formatPoints(card.value)} pts`}</strong>
    {card.row ? <InsightsIdentity row={card.row} ownerMap={ownerMap} yearSpecific={yearSpecific} /> : <p className="table-meta">{card.label === copy.leagueAverage ? copy.perWeek : copy.noScoredWeeks}</p>}
  </article>)}</div>;
}

export function ScoringBoards({ scoring, ownerMap, yearSpecific, label }) {
  const mobile = useMobileLayout();
  const summary = scoringSummary(scoring);
  const leader = summary.rows[0];
  const copy = INSIGHTS_COPY.scoring;
  if (!leader) return null;
  const awardTitle = scoring.awards?.find(award => award.id === "points_king")?.title || copy.mostPoints;
  return <div className="hub-insights-scoring-boards">
    <div className="hub-insights-board-intro"><h2>{copy.awards}</h2><p className="table-meta">{label}</p></div>
    {mobile ? <div className="hub-insights-podium">{summary.rows.slice(0, 3).map((row, index) => <article className={`hub-insights-board-panel hub-insights-podium-card${index === 0 ? " is-leader" : ""}`} key={scoringTeamKey(row)}>
      <div className="hub-insights-podium-label"><h3>{index === 0 ? copy.pointsLeader : copy.placeInPoints(index + 1)}</h3><span>{copy.weeks(row.weeks_scored)}</span></div>
      <InsightsIdentity row={row} ownerMap={ownerMap} yearSpecific={yearSpecific} />
      <strong className="hub-insights-podium-value">{formatPoints(row.total_points)} <small>pts</small></strong>
    </article>)}</div> : <>
      <article className="hub-insights-board-panel hub-insights-scoring-feature">
        <div><h3 className="hub-insights-board-kicker">{awardTitle}</h3><InsightsIdentity row={leader} ownerMap={ownerMap} yearSpecific={yearSpecific}><small>{copy.weeksScored(leader.weeks_scored)}</small></InsightsIdentity></div>
        <div className="hub-insights-feature-stat"><strong>{formatPoints(leader.total_points)}</strong><span>{copy.actualPoints}</span></div>
      </article>
      <SmallScoringAwards summary={summary} ownerMap={ownerMap} yearSpecific={yearSpecific} awards={scoring.awards} />
    </>}
    <section className="hub-insights-board-panel" aria-label={yearSpecific ? copy.rankings : copy.careerRankings}>
      <div className="hub-insights-board-heading"><h3>{yearSpecific ? copy.rankings : copy.careerRankings}</h3><span className="table-meta">{copy.totalPoints}</span></div>
      <ol className="hub-insights-score-list">{summary.rows.map((row, index) => <li className="hub-insights-score-row" key={scoringTeamKey(row)}>
        <span className="hub-insights-rank-place">{index + 1}</span>
        <InsightsIdentity row={row} ownerMap={ownerMap} yearSpecific={yearSpecific} />
        <div className="hub-insights-board-stat"><strong>{formatPoints(row.total_points)}</strong><small>{formatPoints(row.avg_points)} {copy.averageShort}</small></div>
        {!mobile && <div className={`hub-insights-score-track${index === 0 ? " is-leader" : ""}`} aria-hidden="true"><span style={{ width: `${leader.total_points > 0 ? Math.max(0, row.total_points / leader.total_points * 100) : 0}%` }} /></div>}
      </li>)}</ol>
    </section>
    {mobile && <details className="hub-insights-board-panel hub-insights-support-details"><summary>{copy.weeklyHighlights}</summary><SmallScoringAwards summary={summary} ownerMap={ownerMap} yearSpecific={yearSpecific} awards={scoring.awards} /></details>}
  </div>;
}

function SpendStack({ row, positions, includeDeadCap = true }) {
  const total = positions.reduce((sum, pos) => sum + Math.max(0, metricValue(row, pos, "pct")), 0) + (includeDeadCap ? Math.max(0, Number(row.pct_dead_cap) || 0) : 0);
  const scale = Math.max(100, total);
  return <div className="hub-insights-spend-stack" aria-hidden="true">{positions.map(pos => <span key={pos} style={{ background: POS_COLORS[pos], width: `${Math.max(0, metricValue(row, pos, "pct")) / scale * 100}%` }} />)}{includeDeadCap && Number(row.pct_dead_cap) > 0 && <span className="hub-insights-dead-cap" style={{ width: `${row.pct_dead_cap / scale * 100}%` }} />}</div>;
}

export function SpendBoards({ teams, positions, metric, onMetric, allTime, ownerMap, yearSpecific, label }) {
  const mobile = useMobileLayout();
  const [position, setPosition] = useState("all");
  // A league switch may remove a position; do not leave the list silently filtered.
  const selectedPosition = positions.includes(position) ? position : "all";
  const rows = spendComparisonRows(teams, selectedPosition, metric);
  const leader = spendComparisonRows(teams, "all", metric)[0];
  const copy = INSIGHTS_COPY.spend;
  const value = row => formatSpendValue(selectedPosition === "all" ? (metric === "pct" ? row.pct_committed : row.committed) : metricValue(row, selectedPosition, metric), metric);
  return <div className="hub-insights-spend-boards">
    <div className="hub-insights-board-toolbar">
      <div className="hub-insights-board-intro"><h2>{copy.heading}</h2><p className="table-meta">{allTime ? copy.averageCap : label}</p></div>
      <div className="hub-insights-board-filters"><HubFilterMenu label="Position" ariaLabel="Spend position" value={selectedPosition} onChange={setPosition} options={[{id:"all",label:"All positions"}, ...positions.map(pos => ({id:pos,label:pos}))]} />
        {!allTime && <div className="hub-insights-spend-units" role="group" aria-label={copy.showAs}><HubFilterChip active={metric === "dollars"} onClick={() => onMetric("dollars")}>{copy.totalDollars}</HubFilterChip><HubFilterChip active={metric === "pct"} onClick={() => onMetric("pct")}>{copy.capPercent}</HubFilterChip></div>}
      </div>
    </div>
    {!mobile && leader && <div className="hub-insights-spend-features">
      <article className="hub-insights-board-panel hub-insights-spend-feature"><h3 className="hub-insights-board-kicker">{copy.mostCommitted}</h3><InsightsIdentity row={leader} ownerMap={ownerMap} yearSpecific={yearSpecific} /><strong className="hub-insights-spend-feature-value">{formatSpendValue(metric === "pct" ? leader.pct_committed : leader.committed, metric)}</strong><p className="table-meta">{allTime ? copy.averageCap : copy.capRemaining(formatSpendValue(metric === "pct" ? leader.pct_unspent : leader.unspent, metric))}</p><SpendStack row={leader} positions={positions} /></article>
      <section className="hub-insights-board-panel hub-insights-allocation"><h3>{copy.allocation}</h3><p className="table-meta">{insightsIdentityParts(leader, ownerMap, yearSpecific).primary}</p><ul>{positions.map(pos => <li key={pos}><span><i style={{background:POS_COLORS[pos]}} aria-hidden="true" />{pos}</span><strong>{formatSpendValue(metricValue(leader, pos, metric), metric)}</strong></li>)}</ul>{Number(leader.dead_cap) > 0 && <p className="table-meta">{copy.deadCap(formatSpendValue(metric === "pct" ? leader.pct_dead_cap : leader.dead_cap, metric))}</p>}</section>
    </div>}
    <section className="hub-insights-board-panel" aria-label={copy.comparison}>
      <div className="hub-insights-board-heading"><h3>{copy.comparison}</h3><span className="table-meta">{selectedPosition === "all" ? copy.committed : selectedPosition}</span></div>
      <ol className="hub-insights-spend-list">{rows.map((row,index) => <li className="hub-insights-spend-row" key={scoringTeamKey(row)}>
        <span className="hub-insights-rank-place">{index + 1}</span><InsightsIdentity row={row} ownerMap={ownerMap} yearSpecific={yearSpecific} />
        <div className="hub-insights-board-stat"><strong>{value(row)}</strong>{metric === "dollars" && <small>{formatSpendValue(selectedPosition === "all" ? row.pct_committed : metricValue(row, selectedPosition, "pct"), "pct")} {copy.ofCap}</small>}</div>
        <SpendStack row={row} includeDeadCap={selectedPosition === "all"} positions={selectedPosition === "all" ? positions : [selectedPosition]} />
      </li>)}</ol>
      {!rows.length && <p className="chart-note">{copy.empty}</p>}
      <div className="hub-insights-spend-legend">{positions.map(pos => <span key={pos}><i style={{background:POS_COLORS[pos]}} aria-hidden="true" />{pos}</span>)}{selectedPosition === "all" && teams.some(row => Number(row.pct_dead_cap) > 0) && <span><i className="hub-insights-dead-cap" aria-hidden="true" />{copy.deadCapLabel}</span>}</div>
    </section>
  </div>;
}
