import React from "react";
import GameCenter from "./GameCenter";
import WeeklyCommandCenter from "./WeeklyCommandCenter";
import "../styles/weekly-experience.css";

/** One league week owns the matchup, lineup editor and league results. */
export default function WeeklyExperience({ cacheScope, hubContext, requestedWeek, requestedTeam, reloadToken, onNavigate, onSynced, onNavigateSetup }) {
  if (hubContext?.mode !== "league" || !hubContext?.league_id) {
    return <WeeklyCommandCenter {...{cacheScope, hubContext, reloadToken, onNavigate, onSynced, onNavigateSetup}} />;
  }
  const ownTeam = !requestedTeam || String(requestedTeam) === String(hubContext.team_id);
  return <GameCenter key={`${hubContext.league_id}:${requestedTeam || hubContext.team_id}`} leagueId={hubContext.league_id} hubContext={hubContext}
    requestedWeek={requestedWeek} requestedTeam={requestedTeam} reloadToken={reloadToken} onNavigate={onNavigate} weekly
    renderLineup={ownTeam ? ({week, onChanged, onSummary, scorePlayers, gameCenterData}) => <WeeklyCommandCenter
      key={`${hubContext.league_id}:${hubContext.team_id}:${week || "auto"}`}
      {...{cacheScope, hubContext, reloadToken, onNavigate, onSynced, onNavigateSetup}}
      requestedWeek={week} scorePlayers={scorePlayers} gameCenterData={gameCenterData} embedded onLineupChanged={onChanged} onSummary={onSummary} /> : null} />;
}
