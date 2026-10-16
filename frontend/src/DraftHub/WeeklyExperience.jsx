import React from "react";
import GameCenter from "./GameCenter";
import LeagueHome from "./LeagueHome";
import {HubPage} from "./HubUILayout";
import {WEEK_OVERVIEW_COPY as C} from "./weekOverviewPresentation";

/** Compatibility wrapper: the weekly landing is Home; Game center keeps matchup detail. */
export default function WeeklyExperience({hubContext,requestedWeek,requestedTeam,reloadToken,onNavigate,detail=false}) {
 if(!detail)return <LeagueHome {...{hubContext,requestedWeek,reloadToken,onNavigate}} />;
 if(hubContext?.mode!=="league"||!hubContext?.league_id)return <HubPage><h1>{C.title}</h1><p>{C.noLeague}</p><button className="btn-ghost" onClick={()=>onNavigate?.("roster")}>{C.review}</button></HubPage>;
 return <GameCenter key={`${hubContext.league_id}:${detail?requestedTeam||hubContext.team_id:"overview"}`}
  leagueId={hubContext.league_id} hubContext={hubContext} requestedWeek={requestedWeek}
  requestedTeam={detail?requestedTeam:hubContext.team_id} reloadToken={reloadToken} onNavigate={onNavigate} overview={!detail}/>;
}
