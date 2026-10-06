import React, { useMemo, useState } from "react";
import { HubPage } from "../HubUILayout";
import useMobileLayout from "../../useMobileLayout";
import { InsightsOverviewSkeleton } from "./InsightsChrome";
import { championYearRows, formatPoints, formatRecordLine, INSIGHTS_COPY,
  overviewPlaque, scoringTeamKey, teamDisplayName } from "./insightsPresentation";

export default function InsightsOverview({ landing, ownerMap, loading, error, onOpenTab }) {
  const [sort, setSort] = useState("record");
  const mobile = useMobileLayout();
  const copy = INSIGHTS_COPY.overview;
  const plaque = useMemo(() => overviewPlaque(landing?.most_titles, landing?.champions || [], ownerMap), [landing, ownerMap]);
  const years = useMemo(() => championYearRows(landing?.champions || [], landing?.most_titles, ownerMap), [landing, ownerMap]);
  const records = sort === "record" ? landing?.record_leaders || [] : landing?.scoring_leaders || [];
  const pointsLeader = Math.max(0, ...(landing?.scoring_leaders || []).map((r) => Number(r.total_points) || 0));
  const recordHighlight = (landing?.record_leaders || []).find(row =>
    Number(row.wins || 0) + Number(row.losses || 0) + Number(row.ties || 0) > 0);
  const pointsHighlight = (landing?.scoring_leaders || []).find(row =>
    Number(row.weeks_scored || 0) > 0 || Number(row.total_points || 0) > 0);
  return <HubPage frameless className="hub-insights-page hub-insights-page--overview">
    {loading && !landing?.available && <InsightsOverviewSkeleton />}
    {!loading && !error && !landing?.available && <p className="chart-note">{landing?.hint || copy.empty}</p>}
    {landing?.available && <div className="hub-insights-overview">
      <div className="hub-insights-championships hub-insights-championships--story">
        {plaque ? <section className="hub-insights-plaque" aria-label="Most championships">
          <span className="hub-insights-trophy-mark" aria-hidden="true"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 3h8v7a4 4 0 0 1-8 0V3ZM8 5H4v3a4 4 0 0 0 4 4M16 5h4v3a4 4 0 0 1-4 4M12 14v5M8 21h8M10 19h4" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
          <div><p className="hub-insights-plaque-kicker">{copy.mostChampionships}</p><h2>{plaque.owner}</h2>{plaque.team && <p className="hub-insights-plaque-team">{plaque.team}</p>}<p>{plaque.lastSeason && `Latest title · ${plaque.lastSeason}`}{plaque.runnerUp && ` · Defeated ${plaque.runnerUp}`}</p></div>
          <div className="hub-insights-plaque-count"><strong>{plaque.titles}</strong><span>{plaque.titles === 1 ? "title" : "titles"}</span></div>
        </section> : <p className="chart-note hub-insights-titles-empty">{copy.titlesEmpty}</p>}
        <section className="hub-insights-championship-timeline">
          <div className="hub-insights-talk-head"><h3>{copy.titlesYears}</h3></div>
          <div className="hub-insights-years">{years.map((r) => <article key={r.season} className={`hub-insights-year${r.dynasty ? " is-dynasty" : ""}`}><time dateTime={String(r.season)}>{r.season}</time><div className="hub-insights-year-winner"><strong>{r.owner}</strong>{r.team && <span>{r.team}</span>}</div></article>)}</div>
          {!years.length && <p className="chart-note">{copy.titlesNone}</p>}
        </section>
      </div>
      <section className="hub-insights-overview-panel hub-insights-record-book" aria-label="Record book">
        <div className="hub-insights-talk-head hub-insights-talk-head--row"><div><h2>{copy.recordBook}</h2><p className="hub-insights-record-description">{copy.recordBookSupport}</p></div></div>
        {(recordHighlight || pointsHighlight) && <div className="hub-insights-record-highlights">
          {[{ row: recordHighlight, label: copy.bestRecord, value: recordHighlight ? `${(Number(recordHighlight.win_pct || 0) * 100).toFixed(1)}%` : "", record: true },
            { row: pointsHighlight, label: copy.mostPoints, value: pointsHighlight ? formatPoints(pointsHighlight.total_points) : "" }].filter(item => item.row).map(({ row, label, value, record }) => {
            const owner = teamDisplayName(row, ownerMap, false);
            return <article className="hub-insights-record-highlight" key={label} aria-label={label}>
              <h3>{label}</h3><strong>{value}</strong><span>{owner}</span>
              {row.team_name !== owner && <small>{row.team_name}</small>}
              {record && <small>{formatRecordLine(row)}</small>}
            </article>;
          })}
        </div>}
        <div className="hub-insights-record-controls"><div className="hub-insights-record-sort" role="radiogroup" aria-label={copy.rankBy} onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === "Home" ? "record" : event.key === "End" ? "points" : sort === "record" ? "points" : "record";
          setSort(next);
          event.currentTarget.querySelectorAll("button")[next === "record" ? 0 : 1].focus();
        }}><button type="button" className="btn-ghost" role="radio" aria-checked={sort === "record"} tabIndex={sort === "record" ? 0 : -1} onClick={() => setSort("record")}>{copy.recordSort}</button><button type="button" className="btn-ghost" role="radio" aria-checked={sort === "points"} tabIndex={sort === "points" ? 0 : -1} onClick={() => setSort("points")}>{copy.pointsSort}</button></div><button type="button" className="btn-ghost btn-sm hub-insights-open-scoring" onClick={() => onOpenTab("scoring")}>{copy.openScoring}</button></div>
        <ol className="hub-insights-record-list">{records.map((row, index) => {
          const owner = teamDisplayName(row, ownerMap, false);
          const gap = pointsLeader - Number(row.total_points || 0);
          return <li key={`${scoringTeamKey(row)}:${index}`}><span className="hub-insights-rank-place">{index + 1}</span><div className="hub-insights-record-identity"><strong>{owner}</strong>{row.team_name !== owner && <span>{row.team_name}</span>}<small>{formatRecordLine(row)}{sort === "record" && ` · ${formatPoints(row.total_points)} pts`}</small></div><div className="hub-insights-record-points"><strong>{sort === "record" ? `${(Number(row.win_pct || 0) * 100).toFixed(1)}%` : formatPoints(row.total_points)}</strong><span>{sort === "record" ? copy.winRate : gap > 0 ? `−${formatPoints(gap)} from first` : copy.pointsLeader}</span></div></li>;
        })}</ol>
        {!records.length && <p className="chart-note">{copy.recordsEmpty}</p>}
      </section>
      {(landing.current_standings || []).length > 0 && <section className="hub-insights-overview-panel" aria-label={copy.standings}>
        <div className="hub-insights-talk-head"><h2>{copy.standings}</h2><p className="chart-note">{copy.standingsSupport(landing.current_season)}</p></div>
        <div className="table-wrap"><table className="data-table hub-table hub-table--packed">
          <thead><tr><th className="num">{copy.rank}</th><th>{copy.manager}</th><th className="num">{copy.record}</th><th className="num" aria-label={copy.pointsFor}>{mobile ? "PF" : copy.pointsFor}</th><th className="num" aria-label={copy.pointsAgainst}>{mobile ? "PA" : copy.pointsAgainst}</th></tr></thead>
          <tbody>{landing.current_standings.map((row, index) => <tr key={`${scoringTeamKey(row)}:${index}`}><td className="num">{row.rank == null ? "—" : row.rank}</td><td>{teamDisplayName(row, ownerMap, true)}</td><td className="num">{formatRecordLine(row)}</td><td className="num">{formatPoints(row.points_for ?? row.total_points)}</td><td className="num">{row.points_against == null ? "—" : formatPoints(row.points_against)}</td></tr>)}</tbody>
        </table></div>
      </section>}
      {landing.partial && <p className="chart-note">{copy.partial}. Refresh history to fill in missing seasons.</p>}
    </div>}
  </HubPage>;
}
