import React, { useMemo } from "react";
import { formatCount } from "../../formatCount";
import { HubExperienceHero, HubPage } from "../HubUILayout";
import { InsightsOverviewSkeleton } from "./InsightsChrome";
import { RankBars } from "./InsightsTalk";
import {
  formatRecordLine,
  formatScoringRankValue,
  INSIGHTS_COPY,
  mostTitlesLine,
  overviewRecordRows,
  overviewScoringRows,
  teamDisplayName,
} from "./insightsPresentation";

export default function InsightsOverview({
  landing,
  ownerMap,
  loading,
  onOpenTab,
}) {
  const copy = INSIGHTS_COPY.overview;
  const champions = landing?.champions || [];
  const hasLanding = Boolean(landing?.available);
  const seasonCount = landing?.seasons_included?.length || 0;
  const titlesLine = mostTitlesLine(landing?.most_titles, ownerMap);
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
        support={copy.support}
      />

      {loading && !hasLanding && <InsightsOverviewSkeleton />}

      {!loading && !hasLanding && (
        <p className="chart-note">{landing?.hint || copy.empty}</p>
      )}

      {hasLanding && (
        <>
          {seasonCount ? (
            <p className="hub-insights-overview-meta">{formatCount(seasonCount, "season")}</p>
          ) : null}
          <div className="hub-insights-overview-grid">
            <section className="hub-insights-overview-panel" aria-label={copy.titles}>
              <div className="hub-insights-talk-head">
                <h3>{copy.titles}</h3>
                <p>{titlesLine || (champions.length ? copy.titlesSupport : copy.titlesEmpty)}</p>
              </div>
              {champions.length ? (
                <ol className="hub-insights-champions">
                  {champions.map((row) => (
                    <li key={row.season}>
                      <span className="hub-insights-champions-year">{row.season}</span>
                      <strong>{teamDisplayName(row, ownerMap, true)}</strong>
                      {row.runner_up ? (
                        <span className="chart-note">def. {row.runner_up}</span>
                      ) : null}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="chart-note">{copy.titlesNone}</p>
              )}
            </section>

            <section className="hub-insights-overview-panel" aria-label={copy.records}>
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
                />
              ) : (
                <p className="chart-note">{copy.recordsEmpty}</p>
              )}
            </section>

            <section className="hub-insights-overview-panel" aria-label={copy.scoring}>
              <div className="hub-insights-talk-head">
                <h3>{copy.scoring}</h3>
                <p>{copy.scoringSupport}</p>
              </div>
              {scoringRows.length ? (
                <RankBars
                  rows={scoringRows}
                  formatValue={(row) => formatScoringRankValue(row)}
                />
              ) : (
                <p className="chart-note">{copy.scoringEmpty}</p>
              )}
              <button type="button" className="btn-link btn-sm" onClick={() => onOpenTab("scoring")}>
                {copy.openScoring}
              </button>
            </section>
          </div>
        </>
      )}
    </HubPage>
  );
}
