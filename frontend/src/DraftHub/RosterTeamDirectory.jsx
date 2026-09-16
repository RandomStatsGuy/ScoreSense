import React, { useState } from "react";
import { ROSTER_BOARD_COPY as C, ownerLine, nicknameLine, activeRoster, rosterMoney } from "./leagueRostersPresentation";

export default function RosterTeamDirectory({ blocks, myTeamId, onChoose, headingRef, usesSalaries = true }) {
  const [search, setSearch] = useState("");
  const needle = search.trim().toLowerCase();
  const matches = blocks.filter(b => `${ownerLine(b.team)} ${nicknameLine(b.team)}`.toLowerCase().includes(needle));
  return <div className="rosters-team-directory">
    <div className="rosters-directory-heading"><div><h2 ref={headingRef} tabIndex={-1}>{C.chooseTeam}</h2><p>{usesSalaries ? C.chooseTeamHelp : C.choosePlayerTeamHelp}</p></div>
      <label className="rosters-search"><input aria-label={C.teamSearch} placeholder={C.teamSearch} value={search} onChange={e => setSearch(e.target.value)} /></label>
    </div>
    <div className="rosters-team-grid">{matches.map(b => <button key={b.team.id} type="button" className="rosters-team-card" onClick={() => onChoose(b.team.id)} aria-label={C.openTeam(ownerLine(b.team))}>
      <span className="rosters-team-owner">{ownerLine(b.team)}{b.team.id === myTeamId && <small>{C.yourTeam}</small>}</span>
      <span className="rosters-team-name">{nicknameLine(b.team) || C.teamRoster}</span>
      <span className="rosters-team-facts"><span>{C.playerCount(activeRoster(b).length)}</span>{usesSalaries && <span>{C.capRoom}<strong>{rosterMoney(b.stats?.unspent)}</strong></span>}</span>
      <span className="rosters-team-open">{C.viewRoster} <span aria-hidden="true">→</span></span>
    </button>)}</div>
    {!matches.length && <p className="rosters-empty">{blocks.length ? C.noMatchingTeams : C.noTeams}</p>}
  </div>;
}
