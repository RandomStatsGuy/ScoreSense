import React, { useMemo, useState } from "react";
import { fmtSal } from "./rosterFormat";
import { formatPickSlot } from "./draftRoomHelpers";
import HoverTip, { TipLine, TipTitle } from "../HoverTip";
import {
  formatExpectedRecord,
  formatPlayoffPct,
  outcomeBandLabel,
  recapCopyIsPickDraftSafe,
  sortStandings,
  viewerInsight,
} from "./recapFormat";

const GRADE_LABEL = {
  steal: "Steal",
  great_value: "Great value",
  fair: "Fair",
  slight_reach: "Slight reach",
  reach: "Reach",
  major_reach: "Major reach",
  pick: "Sold",
};

function StandingsTable({ standings, viewerTeamId, recordGames, outcomeNote, mobile }) {
  const [sortKey, setSortKey] = useState("rank");
  const [sortDir, setSortDir] = useState("asc");
  const rows = useMemo(
    () => sortStandings(standings, sortKey, sortDir),
    [standings, sortKey, sortDir],
  );
  const onSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "team_name" ? "asc" : (key === "rank" ? "asc" : "desc"));
    }
  };
  const tip = (
    <>
      <TipTitle>Outcome bands</TipTitle>
      <TipLine>{outcomeNote || "Floor / P10 is the downside, Median / P50 the typical outcome, Ceiling / P90 the upside. These are starter-only simulated season points, not the sum of each player's P10."}</TipLine>
    </>
  );

  if (mobile) {
    return (
      <div className="hub-recap-standings-cards">
        {rows.map((row) => {
          const mine = String(row.team_id) === String(viewerTeamId);
          return (
            <article key={row.team_id} className={`hub-recap-standings-card${mine ? " is-viewer" : ""}`}>
              <header>
                <strong>#{row.rank} {row.team_name}</strong>
                {mine ? <span className="hub-team-tag">You</span> : null}
              </header>
              <p className="chart-note">{formatExpectedRecord(row, recordGames)} · playoff {formatPlayoffPct(row.playoff_probability)}</p>
              <p>
                Floor {row.points_p10?.toFixed?.(0) ?? "—"}
                {" · "}Median {row.points_p50?.toFixed?.(0) ?? "—"}
                {" · "}Ceiling {row.points_p90?.toFixed?.(0) ?? "—"}
              </p>
            </article>
          );
        })}
      </div>
    );
  }

  return (
    <div className="hub-recap-standings-wrap">
      <table className="hub-recap-standings">
        <thead>
          <tr>
            <th onClick={() => onSort("rank")}>#</th>
            <th onClick={() => onSort("team_name")}>Team</th>
            <th onClick={() => onSort("expected_wins")}>Record</th>
            <HoverTip as="th" content={tip} className="col-tip" onClick={() => onSort("points_p10")}>
              {outcomeBandLabel("points_p10")}
            </HoverTip>
            <HoverTip as="th" content={tip} className="col-tip" onClick={() => onSort("points_p50")}>
              {outcomeBandLabel("points_p50")}
            </HoverTip>
            <HoverTip as="th" content={tip} className="col-tip" onClick={() => onSort("points_p90")}>
              {outcomeBandLabel("points_p90")}
            </HoverTip>
            <th onClick={() => onSort("playoff_probability")}>Playoffs</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const mine = String(row.team_id) === String(viewerTeamId);
            return (
              <tr key={row.team_id} className={mine ? "is-viewer" : undefined}>
                <td>{row.rank}</td>
                <td>
                  {row.team_name}
                  {mine ? <span className="hub-team-tag">You</span> : null}
                </td>
                <td>{formatExpectedRecord(row, recordGames)}</td>
                <td>{row.points_p10?.toFixed?.(1) ?? "—"}</td>
                <td>{row.points_p50?.toFixed?.(1) ?? "—"}</td>
                <td>{row.points_p90?.toFixed?.(1) ?? "—"}</td>
                <td>{formatPlayoffPct(row.playoff_probability)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {recordGames ? <p className="chart-note">Record is projected over {recordGames} fantasy games.</p> : null}
    </div>
  );
}

export default function DraftRecapPanel({
  recap,
  compact = false,
  hideHero = false,
  onViewInsights,
  viewerTeamId = null,
  board = null,
  mobile = false,
}) {
  if (!recap) return null;
  const pickDraft = Boolean(recap.pick_draft);
  const hasAwards = (recap.awards?.length ?? 0) > 0;
  const hasNotable = (recap.notable_picks?.length ?? 0) > 0;
  const hasStandings = (recap.projected_standings?.length ?? 0) > 0;
  if (!hasAwards && !hasNotable && !pickDraft && !hasStandings) return null;

  const insight = viewerInsight(recap, viewerTeamId);
  const dtype = String(recap.draft_type || "").toLowerCase();

  return (
    <section className={`hub-draft-recap${compact ? " hub-draft-recap-compact" : ""}${pickDraft ? " hub-draft-recap--picks" : ""}`}>
      {!hideHero && (
        <div className="hub-draft-recap-hero">
          <div>
            <p className="hub-draft-recap-kicker">Recap</p>
            <h3>{recap.headline}</h3>
            {recap.subheadline && <p className="chart-note">{recap.subheadline}</p>}
            {recap.scopes && (
              <p className="chart-note">
                {pickDraft
                  ? <>{recap.pick_count} picks{dtype ? ` · ${dtype} draft` : ""}.</>
                  : recap.scopes.this_mock && <>This mock: {recap.scopes.this_mock.auction_wins} auction wins · {fmtSal(recap.scopes.this_mock.total_spent)} spent. </>}
                {!pickDraft && recap.scopes.league_wide && <>League-wide: {recap.scopes.league_wide.rostered_count} rostered in sandbox.</>}
                {!pickDraft && recap.limits_relaxed ? " Cap-efficiency awards hidden while salary limits are off." : ""}
              </p>
            )}
          </div>
          {onViewInsights && (
            <button type="button" className="btn-ghost btn-sm" onClick={onViewInsights}>
              Insights
            </button>
          )}
        </div>
      )}

      {pickDraft && insight && (
        <article className="hub-recap-grade">
          <p className="hub-draft-recap-kicker">Your team</p>
          <h3>
            <span className="hub-recap-letter">{insight.grade || "—"}</span>
            {" "}
            {insight.team_name}
          </h3>
          {insight.summary && <p>{insight.summary}</p>}
          {insight.strengths?.length > 0 && (
            <p className="chart-note">Strengths: {insight.strengths.join(" · ")}</p>
          )}
          {insight.needs?.length > 0 && (
            <p className="chart-note">Needs: {insight.needs.join(" · ")}</p>
          )}
        </article>
      )}

      {pickDraft && hasStandings && (
        <div className="hub-recap-standings-block">
          <h3>Projected standings</h3>
          <StandingsTable
            standings={recap.projected_standings}
            viewerTeamId={viewerTeamId}
            recordGames={recap.record_games}
            outcomeNote={recap.outcome_note}
            mobile={mobile}
          />
          {recap.methodology && <p className="chart-note hub-recap-method">{recap.methodology}</p>}
        </div>
      )}

      {pickDraft && insight && (insight.strengths?.length || insight.needs?.length) ? (
        <div className="hub-recap-swot">
          <h3>Roster construction</h3>
          <p className="chart-note">
            Starter-aware median: {insight.starter_points_p50 ?? "—"} pts
            {insight.awards?.length ? ` · ${insight.awards.join(" · ")}` : ""}
          </p>
        </div>
      ) : null}

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

      {board}

      {recap.notable_picks?.length > 0 && (
        <div className="hub-draft-recap-notable">
          <h3>{pickDraft ? "Notable picks" : "Notable sales"}</h3>
          <ul>
            {recap.notable_picks.map((pick) => (
              <li key={`${pick.player_id}-${pick.team_id}`}>
                <span className={`hub-draft-recap-grade hub-draft-recap-grade-${pickDraft ? "pick" : pick.value_grade}`}>
                  {pickDraft ? (formatPickSlot(pick) || "Pick") : (GRADE_LABEL[pick.value_grade] || "Pick")}
                </span>
                <span>
                  {pick.team_name} · {pick.player_name} ({pick.position})
                  {!pickDraft && <> — {fmtSal(pick.amount)}{pick.fair_value != null ? ` · fair ${fmtSal(pick.fair_value)}` : ""}</>}
                  {pickDraft && Number(pick.season_proj) > 0 && <> · {Number(pick.season_proj).toFixed(0)} pts</>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {pickDraft && recapCopyIsPickDraftSafe(recap) === false ? (
        <p className="chart-note">Recap copy should stay in pick-draft language.</p>
      ) : null}
    </section>
  );
}
