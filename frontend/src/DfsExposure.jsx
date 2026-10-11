import React, { useEffect, useMemo, useState } from "react";
import { HubFilterMenu } from "./DraftHub/HubUILayout";
import { appearanceMaximum, exposureRows } from "./dfsExposure.js";
import { DFS_EXPOSURE_COPY as C } from "./dfsToolPresentation.js";

function Maximum({ id, player, value, unit, onChange, disabled }) {
  const display = value == null ? "" : unit === "percent" ? Number((value / 150 * 100).toFixed(2)) : value;
  const [draft, setDraft] = useState(display), [error, setError] = useState("");
  useEffect(() => { setDraft(display); setError(""); }, [display, unit]);
  const commit = () => {
    // Display rounding must never change a count when the user only tabs through.
    if (String(draft) === String(display)) { setError(""); return; }
    try { onChange(id, appearanceMaximum(draft, unit)); setError(""); }
    catch (e) { setError(e.message); }
  };
  return <><input type="number" min="0" max={unit === "percent" ? 100 : 150} step={unit === "percent" ? "any" : 1}
    className="dfw-appearance-limit" aria-label={C.maxFor(player)} aria-invalid={!!error} disabled={disabled}
    value={draft} onChange={e => setDraft(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }} />
    {error && <small className="dfw-error" role="alert">{error}</small>}</>;
}

export default function DfsExposure({ b, disabled = false }) {
  const [scope, setScope] = useState("portfolio"), [query, setQuery] = useState(""),
    [position, setPosition] = useState("ALL"), [filter, setFilter] = useState("all"), [selected, setSelected] = useState([]),
    [bulk, setBulk] = useState(""), [error, setError] = useState("");
  const unit = b.exposureUnit;
  const rows = useMemo(() => exposureRows(b.pool, b.portfolio, b.portfolioLimits), [b.pool, b.portfolio, b.portfolioLimits]);
  const current = useMemo(() => {
    const usage = new Map();
    b.lineups.forEach(entry => new Set(entry.lineup.map(p => p.player_id)).forEach(id => usage.set(id, (usage.get(id) || 0) + 1)));
    return usage;
  }, [b.lineups]);
  const visible = rows.filter(p => (!query || `${p.player} ${p.team || ""}`.toLowerCase().includes(query.toLowerCase())) &&
    (position === "ALL" || p.position === position) && (filter === "all" || (filter === "limited" ? p.max != null : p.max != null && p.count > p.max)));
  const busy = disabled || b.building || b.busy;
  return <div className="dfw-exposure-editor">
    <div className="dfw-actions">
      <HubFilterMenu label={C.view} value={scope} options={[{ id: "portfolio", label: C.portfolio }, { id: "build", label: C.build }]} onChange={setScope} />
      <HubFilterMenu label={C.units} value={unit} options={[{ id: "percent", label: "% of 150" }, { id: "count", label: C.lineups }]} onChange={b.setExposureUnit} />
    </div>
    <p className="dfw-note">{scope === "portfolio" ? C.basis : C.buildBasis(b.lineups.length)}</p>
    <label className="dfw-check"><input type="checkbox" checked={b.usePortfolioLimits} disabled={busy} onChange={e => b.setUsePortfolioLimits(e.target.checked)} />{C.useNext}</label>
    <div className="dfw-actions">
      <input className="dfw-search" aria-label={C.search} placeholder={C.search} value={query} onChange={e => setQuery(e.target.value)} />
      <HubFilterMenu label={C.position} value={position} options={["ALL", "QB", "RB", "WR", "TE", "DST"].map(id => ({ id, label: id === "ALL" ? C.all : id }))} onChange={setPosition} />
      <HubFilterMenu label={C.show} value={filter} options={[{ id: "all", label: C.all }, { id: "limited", label: C.limited }, { id: "over", label: C.over }]} onChange={setFilter} />
    </div>
    {!!selected.length && <div className="dfw-actions">
      <label className="dfw-field"><span>{C.bulk(selected.length, unit)}</span><input type="number" min="0" aria-label={C.bulkLabel} value={bulk} onChange={e => setBulk(e.target.value)} disabled={busy} /></label>
      <button type="button" disabled={busy} onClick={() => { try { const value = appearanceMaximum(bulk, unit); b.setPortfolioLimitsFor(selected, value); setError(""); } catch(e) { setError(e.message); } }}>{C.apply}</button>
      <button type="button" onClick={() => setSelected([])}>{C.clearSelection}</button>
    </div>}
    {error && <p className="dfw-error" role="alert">{error}</p>}
    <div className="dfw-exposure-scroll"><table className="dfw-table dfw-exposure-table">
      <thead><tr><th>{C.player}</th><th className="num">{C.actual}</th><th className="num">{C.maximum(unit)}</th><th className="num">{C.room}</th></tr></thead>
      <tbody>{visible.map(p => { const used = scope === "portfolio" ? p.count : current.get(p.id) || 0;
        const total = scope === "portfolio" ? b.portfolio.reduce((sum, batch) => sum + batch.lineups.length, 0) : b.lineups.length;
        return <tr key={p.id} className={p.max != null && p.count > p.max ? "is-over-limit" : ""}>
          <td><label className="dfw-exposure-player"><input type="checkbox" aria-label={C.select(p.player)} checked={selected.includes(p.id)} onChange={e => setSelected(ids => e.target.checked ? [...ids, p.id] : ids.filter(id => id !== p.id))} /><span>{p.player}<small>{[p.team, p.position].filter(Boolean).join(" · ")}</small></span></label></td>
          <td className="num">{used}<small>{total ? (used / total * 100).toFixed(1) : "0.0"}%</small></td>
          <td className="num"><Maximum id={p.id} player={p.player} value={p.max} unit={unit} disabled={busy} onChange={b.setPortfolioLimit} /><small>{p.max == null ? C.unlimited : C.of150(p.max)}</small></td>
          <td className="num">{p.max == null ? "—" : p.max - p.count}</td>
        </tr>;
      })}</tbody>
    </table></div>
    {!visible.length && <p className="dfw-note">{C.empty}</p>}
    <p className="dfw-note">{C.help}</p>
    {!!Object.keys(b.portfolioLimits).length && <button type="button" disabled={busy} onClick={b.clearPortfolioLimits}>{C.clearLimits}</button>}
  </div>;
}
