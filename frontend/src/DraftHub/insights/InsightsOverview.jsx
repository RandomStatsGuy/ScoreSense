import React, { useMemo, useState } from "react";
import { HubPage } from "../HubUILayout";
import { InsightsOverviewSkeleton } from "./InsightsChrome";
import { championYearRows, fieldRankShare, formatPoints, formatRecordLine, INSIGHTS_COPY,
  overviewPlaque, scoringTeamKey, teamDisplayName } from "./insightsPresentation";

export default function InsightsOverview({ landing, ownerMap, loading, error, onOpenTab }) {
  const [sort, setSort] = useState("record");
  const copy = INSIGHTS_COPY.overview;
  const plaque = useMemo(() => overviewPlaque(landing?.most_titles, landing?.champions || [], ownerMap), [landing, ownerMap]);
  const years = useMemo(() => championYearRows(landing?.champions || [], landing?.most_titles, ownerMap), [landing, ownerMap]);
  const records = sort === "record" ? landing?.record_leaders || [] : landing?.scoring_leaders || [];
  const pointsLeader = Math.max(0, ...(landing?.scoring_leaders || []).map((r) => Number(r.total_points) || 0));
  const values = records.map((r) => Number(sort === "record" ? r.win_pct : r.total_points) || 0);
  return <HubPage frameless className="hub-insights-page hub-insights-page--overview">
    {loading && !landing?.available && <InsightsOverviewSkeleton />}
    {!loading && !error && !landing?.available && <p className="chart-note">{landing?.hint || copy.empty}</p>}
    {landing?.available && <div className="hub-insights-overview">
      <div className="hub-insights-championships">
        {plaque ? <section className="hub-insights-plaque" aria-label="Most championships">
          <div><p className="hub-insights-plaque-kicker">Most championships</p><h2>{plaque.owner}</h2>{plaque.team && <p className="hub-insights-plaque-team">{plaque.team}</p>}<p>{plaque.lastSeason && `Latest title · ${plaque.lastSeason}`}{plaque.runnerUp && ` · Defeated ${plaque.runnerUp}`}</p></div>
          <div className="hub-insights-plaque-count"><strong>{plaque.titles}</strong><span>{plaque.titles === 1 ? "title" : "titles"}</span></div>
        </section> : <p className="chart-note">{copy.titlesEmpty}</p>}
        <section className="hub-insights-overview-panel">
          <div className="hub-insights-talk-head"><h3>{copy.titlesYears}</h3></div>
          <div className="hub-insights-years">{years.map((r) => <article key={r.season} className={`hub-insights-year${r.dynasty ? " is-dynasty" : ""}`}><time dateTime={String(r.season)}>{r.season}</time><div className="hub-insights-year-winner"><strong>{r.owner}</strong>{r.team && <span>{r.team}</span>}</div></article>)}</div>
          {!years.length && <p className="chart-note">{copy.titlesNone}</p>}
        </section>
      </div>
      <section className="hub-insights-overview-panel hub-insights-record-book" aria-label="Record book">
        <div className="hub-insights-talk-head hub-insights-talk-head--row"><div><h2>{copy.recordBook}</h2><p className="hub-insights-record-description">{copy.recordBookSupport}</p></div></div>
        <div className="hub-insights-record-controls"><div className="hub-insights-record-sort" role="radiogroup" aria-label={copy.rankBy} onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === "Home" ? "record" : event.key === "End" ? "points" : sort === "record" ? "points" : "record";
          setSort(next);
          event.currentTarget.querySelectorAll("button")[next === "record" ? 0 : 1].focus();
        }}><button type="button" className="btn-ghost" role="radio" aria-checked={sort === "record"} tabIndex={sort === "record" ? 0 : -1} onClick={() => setSort("record")}>{copy.recordSort}</button><button type="button" className="btn-ghost" role="radio" aria-checked={sort === "points"} tabIndex={sort === "points" ? 0 : -1} onClick={() => setSort("points")}>{copy.pointsSort}</button></div><button type="button" className="btn-ghost btn-sm hub-insights-open-scoring" onClick={() => onOpenTab("scoring")}>{copy.openScoring}</button></div>
        <ol className="hub-insights-record-list">{records.map((row, index) => {
          const owner = teamDisplayName(row, ownerMap, false);
          const value = Number(sort === "record" ? row.win_pct : row.total_points) || 0;
          const gap = pointsLeader - Number(row.total_points || 0);
          return <li key={`${scoringTeamKey(row)}:${index}`}><span className="hub-insights-rank-place">{index + 1}</span><div className="hub-insights-record-identity"><strong>{owner}</strong>{row.team_name !== owner && <span>{row.team_name}</span>}<small>{formatRecordLine(row)}{sort === "record" && ` · ${formatPoints(row.total_points)} pts`}</small></div><div className="hub-insights-record-points"><strong>{sort === "record" ? `${(Number(row.win_pct || 0) * 100).toFixed(1)}%` : formatPoints(row.total_points)}</strong><span>{sort === "record" ? copy.winRate : gap > 0 ? `−${formatPoints(gap)} from first` : copy.pointsLeader}</span></div><div className="hub-insights-record-track" aria-hidden="true"><div style={{ width: `${fieldRankShare(value, values)}%` }} /></div></li>;
        })}</ol>
        {!records.length && <p className="chart-note">{copy.recordsEmpty}</p>}
      </section>
      {landing.partial && <p className="chart-note">{copy.partial}. Refresh history to fill in missing seasons.</p>}
    </div>}
  </HubPage>;
}
