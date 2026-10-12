import React, { useMemo, useState } from "react";
import { HubFilterMenu } from "./DraftHub/HubUILayout.jsx";
import { ruleExposureCount, auditGlobalStructure } from "./dfsGlobalExposure.js";
import { DFS_GLOBAL_COPY as C, DFS_WORKSPACE_COPY as W } from "./dfsToolPresentation.js";
import DfsGroupExposure from "./DfsGroupExposure.jsx";
import { auditClassicStackRules } from "./dfsClassicStackRules.js";
import { DFS_GUARDRAIL_COPY as R } from "./dfsToolPresentation.js";

export default function DfsGlobalExposure({ b }) {
  const [query, setQuery] = useState(""), [page, setPage] = useState(0);
  const count = Number(b.settings.count), rules = b.globalExposure || {};
  const rows = b.pool.filter(p => p.salary != null && String(p.Player).toLowerCase().includes(query.toLowerCase()));
  const actual = useMemo(() => {
    const counts = new Map();
    b.lineups.forEach(entry => new Set(entry.lineup.map(p => p.player_id)).forEach(id => counts.set(id, (counts.get(id) || 0) + 1)));
    return counts;
  }, [b.lineups]);
  const structure = useMemo(() => auditGlobalStructure(b.lineups), [b.lineups]);
  const stackStructure = useMemo(() => {
    const snapshot = b.currentBuild;
    if (!snapshot?.settings.classic_stack_rules) return null;
    const result = { attachments: {}, bring_back: {} };
    try {
      snapshot.lineups.forEach(entry => {
        const audit = auditClassicStackRules(snapshot.settings.classic_stack_rules, entry, snapshot.salaryCatalog, snapshot.settings.build_snapshot?.content?.eligible_players || []);
        for (const section of ["attachments", "bring_back"]) {
          const key = audit[section].relationship_known ? audit[section].actual_count : R.unknown;
          result[section][key] = (result[section][key] || 0) + 1;
        }
      });
      return result;
    } catch (e) { return { error: e.message }; }
  }, [b.currentBuild]);
  const unit = b.globalUnit || "percent";
  const label = kind => ({ min: C.minimum, target: C.target, max: C.maximum })[kind];
  const hint = (rule, kind) => {
    try { const value = ruleExposureCount(rule, count, kind); return value === null ? "—" : C.ruleCount(value, count); }
    catch (error) { return error.message; }
  };
  return <section className="dfw-global" aria-labelledby="dfw-global-title">
    <h3 id="dfw-global-title">{C.title}</h3>
    <label className="dfw-check"><input type="checkbox" checked={b.settings.portfolioMode === "global"} disabled={b.building}
      onChange={e => b.changeSetting("portfolioMode", e.target.checked ? "global" : "legacy")} />{C.enabled}</label>
    <p className="dfw-note">{C.legacy}</p>
    {b.settings.portfolioMode === "global" && <>
      <p className="dfw-note">{C.help}</p>
      <div className="dfw-global-tools">
        <label className="dfw-field"><span>{C.search}</span><input value={query} onChange={e => { setQuery(e.target.value); setPage(0); }} /></label>
        <HubFilterMenu label={C.unit} value={unit} options={[{ id: "percent", label: C.percent }, { id: "count", label: C.count }]}
          onChange={b.setGlobalUnit} disabled={b.building} />
        <button type="button" disabled={b.building || !Object.keys(rules).length} onClick={b.clearGlobalExposure}>{C.clear}</button>
      </div>
      <p className="dfw-note">{C.rounding}</p>
      <div className="dfw-global-rows">
        {rows.slice(page * 6, page * 6 + 6).map(p => {
          const rule = rules[p.player_id] || { unit };
          return <div className="dfw-exposure-row" key={p.player_id}>
            <div className="dfw-exposure-identity"><strong>{p.Player}</strong><small>{p.Position} · {p.Team}
              {b.locked.includes(p.player_id) ? ` · ${C.lock}` : b.excluded.includes(p.player_id) ? ` · ${C.skip}` : ""}</small>
              <span>{C.actual}: {C.actualCount(actual.get(p.player_id) || 0, b.lineups.length)}</span></div>
            <div className="dfw-exposure-controls">{["min", "target", "max"].map(kind => <label className="dfw-field" key={kind}>
              <span>{label(kind)} {unit === "percent" ? "%" : ""}</span><input type="number" inputMode="decimal" min="0" max={unit === "count" ? count : 100}
                step={unit === "count" && kind !== "target" ? "1" : "any"} value={rule[kind] ?? ""} disabled={b.building}
                aria-label={`${label(kind)}: ${p.Player}`} onChange={e => b.setGlobalExposure(p.player_id, kind, e.target.value)} />
              <small>{hint(rule, kind)}</small></label>)}</div>
          </div>;
        })}
      </div>
      {!rows.length && <p className="dfw-note">{C.noPlayers}</p>}
      <div className="dfw-pagination"><span>{Math.min(page + 1, Math.max(1, Math.ceil(rows.length / 6)))} / {Math.max(1, Math.ceil(rows.length / 6))}</span>
        <button disabled={page === 0} onClick={() => setPage(p => p - 1)}>{W.previous}</button>
        <button disabled={(page + 1) * 6 >= rows.length} onClick={() => setPage(p => p + 1)}>{W.next}</button></div>
      <label className="dfw-check"><input type="checkbox" checked={b.settings.blockQbDst !== false} disabled={b.building}
        onChange={e => b.changeSetting("blockQbDst", e.target.checked)} />{C.block}</label><p className="dfw-note">{C.blockHelp}</p>
      <DfsGroupExposure b={b} />
    </>}
    {b.portfolioSelection && <div className="dfw-global-verdict" role="status"><strong>{C.summary(b.portfolioSelection)}</strong><p className="dfw-note">{C.candidateNote}</p>
      {(b.portfolioSelection.targets || []).map(target => <p className="dfw-note" key={`${target.scope}:${target.id}`}>
        {C.targetMiss(b.pool.find(p => p.player_id === target.id)?.Player || b.globalGroups?.find(g => g.id === target.id)?.label || target.id, target.actual_count, target.target_count)}
      </p>)}
      {(b.portfolioSelection.conflicts || []).map((message, i) => <p className="dfw-error" key={i}>{message}</p>)}</div>}
    {!!b.lineups.length && <details><summary>{C.structure}</summary>
      <p className="dfw-note">{C.flex(structure.flex, structure.total)}</p><p className="dfw-note">{C.pairNote}</p>
      {stackStructure && <><h4>{R.actualStacks}</h4>{stackStructure.error ? <p className="dfw-error">{stackStructure.error}</p> :
        <><p className="dfw-note">{R.actualCounts(R.attachments, stackStructure.attachments)}</p><p className="dfw-note">{R.actualCounts(R.bringBack, stackStructure.bring_back)}</p></>}</>}
      <h4>{C.rbPairs}</h4><table className="dfw-table dfw-structure-table"><thead><tr><th>{C.pair}</th><th className="num">{C.appearances}</th></tr></thead>
        <tbody>{structure.pairs.filter(p => p.rb).slice(0, 10).map(pair => <tr key={pair.key}><td>{pair.names.join(" + ")}</td><td className="num">{C.ruleCount(pair.count, structure.total)}</td></tr>)}</tbody></table>
    </details>}
  </section>;
}
