import React from "react";
import { DFS_EXPOSURE_COPY as C, gameTeamCodes, starterQb, dfsPlayerStatus, normalizeDfsTeam } from "./dfsToolPresentation.js";

export default function DfsStackPicker({ b, game }) {
  const teams = gameTeamCodes(game), choices = b.stackChoices[game.game_id] || {};
  const qbs = teams.map(team => starterQb(b.pool, team, { requireSalary: true })).filter(Boolean);
  return <details className="dfw-stack-picker">
    <summary>{C.chooseStacks(Object.keys(choices).length)}</summary>
    <p className="dfw-note">{C.stackHelp}</p>
    {!qbs.length && <p className="dfw-note">{C.noQb}</p>}
    {qbs.map(qb => {
      const included = choices[qb.player_id], active = included !== undefined;
      const sameTeam = p => normalizeDfsTeam(p.Team) === normalizeDfsTeam(qb.Team);
      const available = b.pool.filter(p => teams.includes(normalizeDfsTeam(p.Team)) && (sameTeam(p) ? ["WR", "TE"] : ["RB", "WR", "TE"]).includes(p.Position))
        .sort((a, z) => Number(z["Projected Points"]) - Number(a["Projected Points"]));
      return <div className="dfw-stack-choice" key={qb.player_id}>
        <label className="dfw-check"><input type="checkbox" checked={active} disabled={b.building || b.busy || (!active && b.excluded.includes(qb.player_id))}
          onChange={e => b.setGameStack(game.game_id, qb.player_id, e.target.checked ? [] : null)} />{qb.Player} · {qb.Team}</label>
        {active && <details className="dfw-stack-inclusions"><summary>{C.included(included.length)}</summary><div className="dfw-stack-players">{available.map(p => {
          const selected = included.includes(p.player_id), same = sameTeam(p);
          const group = included.filter(id => sameTeam(b.pool.find(row => row.player_id === id) || {}) === same).length;
          return <label className="dfw-check" key={p.player_id}><input type="checkbox" checked={selected}
            disabled={b.building || b.busy || (!selected && (group >= (same ? 3 : 1) || dfsPlayerStatus(p) !== "available" || b.excluded.includes(p.player_id)))}
            onChange={e => b.setGameStack(game.game_id, qb.player_id, e.target.checked ? [...included, p.player_id] : included.filter(id => id !== p.player_id))} />
            <span>{p.Player}<small>{p.Position} · {same ? C.receiver : C.opposing}</small></span></label>;
        })}</div></details>}
      </div>;
    })}
  </details>;
}
