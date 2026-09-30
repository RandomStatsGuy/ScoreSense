import React from "react";
import { MY_TEAM_COPY as COPY, roomNumber } from "./rosterPresentation";
export function SeasonNumbers({ score, detail = false }) {
  return <span className={`my-team-season-numbers${detail ? " is-detail" : ""}`}>
    <span><strong>{roomNumber(score?.points)}</strong><small>{COPY.seasonPoints}</small></span>
    <span><strong>{roomNumber(score?.ppg)}</strong><small>{COPY.ppg}</small></span>
    {detail && <span><strong>{score?.games ?? "—"}</strong><small>{COPY.games}</small></span>}
    <span><strong className="my-team-position-rank">{score?.rank ? `${score.position}${score.rank}` : "—"}</strong><small>{COPY.positionRank}</small></span>
  </span>;
}
export function SeasonGameLog({ score }) {
  return <section className="my-team-game-log" aria-label={COPY.gameLog}>
    <SeasonNumbers score={score} detail />
    <header><strong>{COPY.gameLog}</strong><span>{COPY.vsProjection}</span></header>
    {!score?.game_log?.length ? <p>{COPY.noScoredGames}</p> : <ol>{score.game_log.map(game => {
      const delta = game.projection == null ? null : game.points - game.projection;
      return <li key={game.week}><span><strong>{COPY.scoringWeek(game.week)}</strong><small>{game.opponent || "—"}</small></span>
        <span><strong>{roomNumber(game.points)}</strong><small>{COPY.gameProjection(roomNumber(game.projection))}</small></span>
        <span className={delta == null || delta === 0 ? "" : delta > 0 ? "is-positive" : "is-caution"} aria-label={delta == null ? COPY.projectionNotSavedShort : COPY.projectionDelta(delta)}>{delta == null ? "—" : `${delta > 0 ? "↑ +" : delta < 0 ? "↓ " : ""}${delta.toFixed(1)}`}</span>
      </li>;
    })}</ol>}
  </section>;
}
