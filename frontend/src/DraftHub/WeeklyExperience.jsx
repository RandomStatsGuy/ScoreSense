import React from "react";
import GameCenter from "./GameCenter";
import WeeklyCommandCenter from "./WeeklyCommandCenter";
import "../styles/weekly-experience.css";

/** One league week owns the matchup, lineup editor and league results. */
export default function WeeklyExperience({ hubContext, requestedWeek, requestedTeam, reloadToken, onNavigate, onSynced, onNavigateSetup }) {
  if (hubContext?.mode !== "league" || !hubContext?.league_id) {
    return <WeeklyCommandCenter {...{hubContext, reloadToken, onNavigate, onSynced, onNavigateSetup}} />;
  }
  const ownTeam = !requestedTeam || String(requestedTeam) === String(hubContext.team_id);
  return <GameCenter key={`${hubContext.league_id}:${requestedTeam || hubContext.team_id}`} leagueId={hubContext.league_id} hubContext={hubContext}
    requestedWeek={requestedWeek} requestedTeam={requestedTeam} reloadToken={reloadToken} onNavigate={onNavigate} weekly
    renderLineup={ownTeam ? ({week, onChanged}) => <WeeklyCommandCenter
      key={`${hubContext.league_id}:${hubContext.team_id}:${week || "auto"}`}
      {...{hubContext, reloadToken, onNavigate, onSynced, onNavigateSetup}}
      requestedWeek={week} embedded onLineupChanged={onChanged} /> : null} />;
}
