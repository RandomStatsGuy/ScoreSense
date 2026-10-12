import React, { useState } from "react";
import { HubFilterMenu } from "./DraftHub/HubUILayout.jsx";
import { DFS_GUARDRAIL_COPY as C, DFS_WORKSPACE_COPY as W } from "./dfsToolPresentation.js";
import { DEFAULT_CLASSIC_STACK_RULES } from "./dfsClassicStackRules.js";

export default function DfsClassicStack({ b }) {
  const [query, setQuery] = useState(""), [page, setPage] = useState(0);
  const rules = b.classicStackRules || DEFAULT_CLASSIC_STACK_RULES;
  const rb = b.pool.filter(p => p.Position === "RB" && p.salary != null && p.Player.toLowerCase().includes(query.toLowerCase()));
  const selected = rules.attachments.receiving_rb_ids;
  return <div className="dfw-guardrail-body" data-testid="dfs-exact-stacks">
    <p className="dfw-note">{C.stackHelp}</p>
    {["attachments", "bring_back"].map(section => <div className="dfw-settings-grid" key={section}>
      <HubFilterMenu label={section === "attachments" ? C.attachments : C.bringBack} value={rules[section].mode} disabled={b.building}
        options={C.modes} onChange={mode => b.changeClassicStack(section, { mode, count: ["optional", "forbidden"].includes(mode) ? 0 : (rules[section].count || 1) })} />
      <HubFilterMenu label={C.stackCount} value={rules[section].count} disabled={b.building || ["optional", "forbidden"].includes(rules[section].mode)}
        options={Array.from({ length: 8 }, (_, id) => ({ id, label: String(id) }))} onChange={count => b.changeClassicStack(section, { count: Number(count) })} />
      <p className="dfw-note">{C.semantics(rules[section], section)}</p>
    </div>)}
    <details><summary>{C.receivingRbs}</summary><div className="dfw-guardrail-body">
      <p className="dfw-note">{C.rbHelp}</p>
      <label className="dfw-field"><span>{C.rbSearch}</span><input value={query} onChange={e => { setQuery(e.target.value); setPage(0); }} /></label>
      <div className="dfw-member-list">{rb.slice(page * 6, page * 6 + 6).map(p => <label className="dfw-check" key={p.player_id}>
        <input type="checkbox" disabled={b.building} checked={selected.includes(p.player_id)} onChange={() => b.changeClassicStack("attachments", {
          receiving_rb_ids: selected.includes(p.player_id) ? selected.filter(id => id !== p.player_id) : [...selected, p.player_id] })} />
        <span>{p.Player}<small>{p.Team}</small></span></label>)}</div>
      {!rb.length && <p className="dfw-note">{C.noRbs}</p>}
      <div className="dfw-pagination"><span>{C.rbSelected(selected.length)}</span><button type="button" disabled={!page} onClick={() => setPage(p => p - 1)}>{W.previous}</button>
        <button type="button" disabled={(page + 1) * 6 >= rb.length} onClick={() => setPage(p => p + 1)}>{W.next}</button></div>
    </div></details>
  </div>;
}
