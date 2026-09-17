import React, { useMemo } from "react";
import { formatCount } from "../../formatCount";
import { HubExperienceHero, HubPage } from "../HubUILayout";
import { InsightsOverviewSkeleton } from "./InsightsChrome";
import { RankBars } from "./InsightsTalk";
import {
  championYearRows,
  formatRecordLine,
  formatScoringRankValue,
  INSIGHTS_COPY,
  overviewPlaque,
  overviewRecordRows,
  overviewScoringRows,
} from "./insightsPresentation";

export default function InsightsOverview({
  landing,
  ownerMap,
  loading,
  error,
  onOpenTab,
  nav = null,
  mineId,
  mineName,
}) {
  const copy = INSIGHTS_COPY.overview;
  const openHistory = (id) => {
    const summary = document.getElementById(id);
    if (!summary) return;
    summary.parentElement.open = true;
    summary.focus();
    summary.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };
  const hasLanding = Boolean(landing?.available);
  const seasonCount = landing?.seasons_included?.length || 0;
  const plaque = useMemo(
    () => overviewPlaque(landing?.most_titles, landing?.champions || [], ownerMap),
    [landing?.most_titles, landing?.champions, ownerMap],
  );
  const years = useMemo(
    () => championYearRows(landing?.champions || [], landing?.most_titles, ownerMap),
    [landing?.champions, landing?.most_titles, ownerMap],
  );
  const recordRows = useMemo(
    () => overviewRecordRows(landing?.record_leaders || [], ownerMap),
    [landing?.record_leaders, ownerMap],
  );
  const scoringRows = useMemo(
    () => overviewScoringRows(landing?.scoring_leaders || [], ownerMap),
    [landing?.scoring_leaders, ownerMap],
  );

  return (
    <HubPage className="hub-spend-page hub-experience-page hub-insights-page hub-insights-page--overview">
      <HubExperienceHero
        eyebrow={copy.eyebrow}
        heading={copy.heading}
        support={
          seasonCount
            ? copy.supportWithSeasons(formatCount(seasonCount, "season"))
            : copy.support
        }
      />
      {nav}

      {loading && !hasLanding && <InsightsOverviewSkeleton />}

      {!loading && !error && landing && !hasLanding && (
        <p className="chart-note">{landing?.hint || copy.empty}</p>
      )}

      {hasLanding && (
        <div className="hub-insights-overview">
          <section className="hub-insights-story-grid" aria-label={copy.stories}>
            <article className="hub-insights-story is-gold">
              <span>{copy.titles}</span>
              <h3>{plaque ? copy.titleStory(plaque.owner) : copy.titleStoryEmpty}</h3>
              <p>{plaque ? copy.plaqueSupport(plaque) : copy.titlesEmpty}</p>
              <button type="button" className="btn-link" onClick={() => openHistory("insights-title-history")}>{copy.openTitles} →</button>
            </article>
            <article className="hub-insights-story">
              <span>{copy.scoringStory}</span>
              <h3>{scoringRows[0]?.label || copy.scoringEmpty}</h3>
              <p>{scoringRows[0] ? copy.scoringStorySupport(scoringRows[0].total) : copy.scoringEmpty}</p>
              <button type="button" className="btn-link" onClick={() => onOpenTab("scoring")}>{copy.openScoring} →</button>
            </article>
            <article className="hub-insights-story">
              <span>{copy.recordStory}</span>
              <h3>{recordRows[0]?.label || copy.recordsEmpty}</h3>
              <p>{recordRows[0] ? copy.recordStorySupport(formatRecordLine(recordRows[0])) : copy.recordsEmpty}</p>
              <button type="button" className="btn-link" onClick={() => openHistory("insights-record-history")}>{copy.openRecords} →</button>
            </article>
          </section>

          <details className="hub-insights-history-disclosure">
            <summary id="insights-title-history">{copy.titlesYears}</summary>
          {plaque ? (
            <section className="hub-insights-plaque" aria-label={copy.titles}>
              <div>
                <p className="hub-insights-plaque-kicker">{copy.titles}</p>
                <h2>{plaque.owner}</h2>
                {plaque.team ? <p className="hub-insights-plaque-team">{plaque.team}</p> : null}
                <p>{copy.plaqueSupport(plaque)}</p>
              </div>
              <div className="hub-insights-plaque-count">
                <strong>{plaque.titles}</strong>
                <span>{copy.titlesNoun}</span>
              </div>
            </section>
          ) : (
            <p className="chart-note">{copy.titlesEmpty}</p>
          )}

          {years.length ? (
            <section className="hub-insights-years" aria-label={copy.titlesYears}>
              {years.map((row) => (
                <article
                  key={row.season}
                  className={`hub-insights-year${row.dynasty ? " is-dynasty" : ""}`}
                >
                  <time dateTime={String(row.season)}>{row.season}</time>
                  <strong>{row.owner}</strong>
                  {row.team ? <span>{row.team}</span> : null}
                  {row.runnerUp ? (
                    <span className="hub-insights-year-runner">{copy.defeated(row.runnerUp)}</span>
                  ) : null}
                </article>
              ))}
            </section>
          ) : (
            <p className="chart-note">{copy.titlesNone}</p>
          )}

          </details>
          <div className="hub-insights-overview-boards">
            <details className="hub-insights-overview-panel" aria-label={copy.records}>
              <summary id="insights-record-history">{copy.records}</summary>
              <div className="hub-insights-talk-head">
                <h3>{copy.records}</h3>
                <p>
                  {landing?.has_records ? copy.recordsSupport : copy.recordsEmpty}
                </p>
              </div>
              {recordRows.length ? (
                <RankBars
                  rows={recordRows}
                  formatValue={(row) => formatRecordLine(row)}
                  mineId={mineId}
                  mineName={mineName}
                />
              ) : (
                <p className="chart-note">{copy.recordsEmpty}</p>
              )}
            </details>

            <section className="hub-insights-overview-panel" aria-label={copy.scoring}>
              <div className="hub-insights-talk-head hub-insights-talk-head--row">
                <div>
                  <h3>{copy.scoring}</h3>
                  <p>{copy.scoringSupport}</p>
                </div>
                <button type="button" className="btn-ghost btn-sm" onClick={() => onOpenTab("scoring")}>
                  {copy.openScoring}
                </button>
              </div>
              {scoringRows.length ? (
                <RankBars
                  rows={scoringRows}
                  formatValue={(row) => formatScoringRankValue(row)}
                  mineId={mineId}
                  mineName={mineName}
                />
              ) : (
                <p className="chart-note">{copy.scoringEmpty}</p>
              )}
            </section>
          </div>
          <nav className="hub-insights-explore" aria-label={copy.explore}>
            <strong>{copy.explore}</strong>
            <button type="button" className="btn-ghost" onClick={() => onOpenTab("scoring")}>{copy.openScoring}</button>
            <button type="button" className="btn-ghost" onClick={() => onOpenTab("ownership")}>{copy.openOwnership}</button>
          </nav>
        </div>
      )}
    </HubPage>
  );
}
