import React from "react";
import { fmtSal } from "./rosterFormat";

const GRADE_LABEL = {
  steal: "Steal",
  great_value: "Great value",
  fair: "Fair",
  slight_reach: "Slight reach",
  reach: "Reach",
  major_reach: "Major reach",
  pick: "Sold",
};

export default function DraftRecapPanel({ recap, compact = false, hideHero = false, onViewInsights }) {
  if (!recap) return null;
  const hasAwards = (recap.awards?.length ?? 0) > 0;
  const hasNotable = (recap.notable_picks?.length ?? 0) > 0;
  if (!hasAwards && !hasNotable) return null;

  return (
    <section className={`hub-draft-recap${compact ? " hub-draft-recap-compact" : ""}`}>
      {!hideHero && (
        <div className="hub-draft-recap-hero">
          <div>
            <p className="hub-draft-recap-kicker">Recap</p>
            <h3>{recap.headline}</h3>
            {recap.subheadline && <p className="chart-note">{recap.subheadline}</p>}
          </div>
          {onViewInsights && (
            <button type="button" className="btn-ghost btn-sm" onClick={onViewInsights}>
              Insights
            </button>
          )}
        </div>
      )}

      {recap.awards?.length > 0 && (
        <div className="hub-draft-recap-awards">
          {recap.awards.map((award) => (
            <article key={award.id} className="hub-draft-recap-award">
              <span className="hub-draft-recap-emoji" aria-hidden>{award.emoji}</span>
              <div>
                <strong>{award.title}</strong>
                <p className="hub-draft-recap-award-who">
                  {award.team_name}
                  {award.player_name ? ` · ${award.player_name}` : ""}
                </p>
                <p className="chart-note">{award.detail}</p>
                <p className="hub-draft-recap-blurb">{award.blurb}</p>
              </div>
            </article>
          ))}
        </div>
      )}

      {recap.notable_picks?.length > 0 && (
        <div className="hub-draft-recap-notable">
          <h3>Notable sales</h3>
          <ul>
            {recap.notable_picks.map((pick) => (
              <li key={`${pick.player_id}-${pick.team_id}`}>
                <span className={`hub-draft-recap-grade hub-draft-recap-grade-${pick.value_grade}`}>
                  {GRADE_LABEL[pick.value_grade] || "Pick"}
                </span>
                <span>
                  {pick.team_name} · {pick.player_name} ({pick.position}) — {fmtSal(pick.amount)}
                  {pick.fair_value != null ? ` · fair ${fmtSal(pick.fair_value)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
