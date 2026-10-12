import React, { useEffect, useState } from "react";
import { ruleExposureCount } from "./dfsGlobalExposure.js";
import { DFS_GUARDRAIL_COPY as C, DFS_GLOBAL_COPY as G, DFS_WORKSPACE_COPY as W } from "./dfsToolPresentation.js";

export default function DfsGroupExposure({ b }) {
  const [query, setQuery] = useState(""), [members, setMembers] = useState([]), [label, setLabel] = useState("");
  const [playerPage, setPlayerPage] = useState(0), [groupPage, setGroupPage] = useState(0), [error, setError] = useState("");
  const contextKey = JSON.stringify([b.context, b.buildPlanValidation?.salarySnapshot?.id]);
  useEffect(() => { setMembers([]); setLabel(""); setQuery(""); setPlayerPage(0); setGroupPage(0); setError(""); }, [contextKey]);
  const groups = b.globalGroups || [], unit = b.globalUnit || "percent", count = Number(b.settings.count);
  const visibleGroupPage = Math.min(groupPage, Math.max(0, Math.ceil(groups.length / 5) - 1));
  const players = b.pool.filter(p => p.salary != null && String(p.Player).toLowerCase().includes(query.toLowerCase()));
  const names = ids => ids.map(id => b.pool.find(p => p.player_id === id)?.Player || id).join(" + ");
  const toggle = id => setMembers(current => current.includes(id) ? current.filter(p => p !== id) : [...current, id]);
  const add = () => {
    if (members.length < 2 || members.length > 9) { setError(C.memberError); return; }
    if (groups.some(g => JSON.stringify([...g.player_ids].sort()) === JSON.stringify([...members].sort()))) { setError(C.duplicateGroup); return; }
    b.addGlobalGroup({ id: `core:${crypto.randomUUID()}`, label: label.trim() || names(members), player_ids: [...members], unit });
    setLabel(""); setMembers([]); setError(""); setGroupPage(Math.floor(groups.length / 5));
  };
  return <details className="dfw-guardrails" data-testid="dfs-group-controls">
    <summary>{C.groups}</summary>
    <div className="dfw-guardrail-body">
      <p className="dfw-note">{C.groupHelp}</p>
      <label className="dfw-field"><span>{C.groupLabel}</span><input maxLength="100" value={label} disabled={b.building} onChange={e => setLabel(e.target.value)} /></label>
      <label className="dfw-field"><span>{C.memberSearch}</span><input value={query} disabled={b.building} onChange={e => { setQuery(e.target.value); setPlayerPage(0); }} /></label>
      <div className="dfw-member-list" role="group" aria-label={C.members}>
        {players.slice(playerPage * 6, playerPage * 6 + 6).map(p => <label className="dfw-check" key={p.player_id}>
          <input type="checkbox" checked={members.includes(p.player_id)} disabled={b.building || (members.length >= 9 && !members.includes(p.player_id))} onChange={() => toggle(p.player_id)} />
          <span>{p.Player}<small>{p.Position} · {p.Team}</small></span>
        </label>)}
      </div>
      <div className="dfw-pagination"><span>{C.selectedMembers(members.length)}</span>
        <button type="button" disabled={!playerPage} onClick={() => setPlayerPage(p => p - 1)}>{W.previous}</button>
        <button type="button" disabled={(playerPage + 1) * 6 >= players.length} onClick={() => setPlayerPage(p => p + 1)}>{W.next}</button></div>
      {!!members.length && <p className="dfw-note">{names(members)}</p>}
      <button type="button" disabled={b.building || groups.length >= 50} onClick={add}>{C.addGroup}</button>
      {error && <p className="dfw-error" role="alert">{error}</p>}
      {!groups.length && <p className="dfw-note">{C.noGroups}</p>}
      {groups.slice(visibleGroupPage * 5, visibleGroupPage * 5 + 5).map(group => {
        const actual = b.lineups.filter(entry => group.player_ids.every(id => entry.lineup.some(p => p.player_id === id))).length;
        return <div className="dfw-exposure-row" key={group.id}>
          <div className="dfw-exposure-identity"><strong>{group.label}</strong><small>{names(group.player_ids)}</small>
            <span>{G.actual}: {G.actualCount(actual, b.lineups.length)}</span>
            <button type="button" disabled={b.building} aria-label={C.removeGroup(group.label)} onClick={() => { b.removeGlobalGroup(group.id); setGroupPage(0); }}>{C.remove}</button></div>
          <div className="dfw-exposure-controls">{["min", "target", "max"].map(kind => {
            let hint; try { const value = ruleExposureCount(group, count, kind); hint = value == null ? "—" : G.ruleCount(value, count); } catch (e) { hint = e.message; }
            return <label className="dfw-field" key={kind}><span>{({ min: G.minimum, target: G.target, max: G.maximum })[kind]} {unit === "percent" ? "%" : ""}</span>
              <input type="number" min="0" max={unit === "count" ? count : 100} step={unit === "count" && kind !== "target" ? "1" : "any"}
                value={group[kind] ?? ""} disabled={b.building} aria-label={C.groupBound(kind, group.label)} onChange={e => b.setGlobalGroup(group.id, kind, e.target.value)} />
              <small>{hint}</small></label>;
          })}</div>
        </div>;
      })}
      {groups.length > 5 && <div className="dfw-pagination"><span>{visibleGroupPage + 1} / {Math.ceil(groups.length / 5)}</span>
        <button type="button" disabled={!visibleGroupPage} onClick={() => setGroupPage(visibleGroupPage - 1)}>{W.previous}</button>
        <button type="button" disabled={(visibleGroupPage + 1) * 5 >= groups.length} onClick={() => setGroupPage(visibleGroupPage + 1)}>{W.next}</button></div>}
    </div>
  </details>;
}
