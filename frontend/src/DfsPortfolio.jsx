import React, { useMemo, useState } from "react";
import { auditPortfolio } from "./dfsPortfolio.js";
import { DFS_PORTFOLIO_COPY as C } from "./dfsToolPresentation.js";

export default function DfsPortfolio({ b, disabled = false, children }) {
  const [label, setLabel] = useState("");
  const audit = useMemo(() => auditPortfolio(b.portfolio, b.portfolioLimits), [b.portfolio, b.portfolioLimits]);
  return (
    <section className="dfw-panel dfw-classic-portfolio" aria-labelledby="dfw-portfolio-title">
      <h2 id="dfw-portfolio-title">{C.title}</h2>
      <p className="dfw-note">{C.help}</p>
      {children}
      <div className="dfw-actions dfw-batch-actions">
        <label className="dfw-field">
          <span>{C.label}</span>
          <input value={label} maxLength={100} onChange={e => setLabel(e.target.value)} disabled={disabled} />
        </label>
        <button type="button" disabled={disabled || b.busy || b.building || !label.trim() || b.currentBuild?.context.site !== "draftkings"}
          onClick={() => { if (b.addPortfolioBatch(label)) setLabel(""); }}>{C.add}</button>
      </div>
      <div className="dfw-portfolio-progress">
        <p role="status">{C.progress(audit.unique, audit.total, audit.batchCount, audit.duplicates.length, audit.shortfall)}</p>
        <meter min="0" max="150" value={Math.min(150, audit.unique)} aria-label={C.title} />
      </div>
      {!b.portfolio.length && <p className="dfw-note">{C.empty}</p>}
      {b.portfolio.map(batch => (
        <div key={batch.id}>
          <div className="dfw-panel-head">
            <details>
              <summary>{C.batchSummary(batch.label, batch.lineups.length, batch.settings.snapshot_at)}</summary>
              <p className="dfw-note">{batch.slateName}</p>
              <ol>{batch.lineups.map((entry, index) => <li key={index}><p className="dfw-note">{entry.lineup.map(p => `${p.slot} ${p.player}`).join(" · ")}</p></li>)}</ol>
            </details>
            <button type="button" disabled={disabled} aria-label={`${C.remove}: ${batch.label}`} onClick={() => b.removePortfolioBatch(batch.id)}>{C.remove}</button>
          </div>
        </div>
      ))}
      {audit.duplicates.map(d => <p className="dfw-error" key={d.index}>{C.duplicate(d.first, d.index, d.batch)}</p>)}
      <p className="dfw-note">{C.auditHelp}</p>
      {!!Object.keys(b.portfolioLimits).length && <button type="button" disabled={disabled} onClick={b.clearPortfolioLimits}>{C.clearLimits}</button>}
      {!!audit.players.length && (
        <div className="dfw-table-scroll">
          <table className="dfw-table dfw-portfolio-audit">
            <thead><tr><th>{C.player}</th><th className="num" title={C.count}>{C.countHeading}</th><th className="num">{C.percent}</th><th className="num" title={C.qb}>{C.qbHeading}</th><th className="num">{C.batches}</th><th className="num" title={C.maximum}>{C.maxHeading}</th></tr></thead>
            <tbody>{audit.players.map(p => <tr key={p.id}>
              <td>{p.player}</td><td className="num">{p.count}</td><td className="num">{`${p.percent.toFixed(1)}%`}</td><td className="num">{p.quarterbacks}</td><td className="num">{p.batchCount}</td>
              <td className="num"><input className="dfw-appearance-limit" type="number" min="0" step="1" aria-label={`${C.maximum}: ${p.player}`} value={b.portfolioLimits[p.id] ?? ""} disabled={disabled} onChange={e => b.setPortfolioLimit(p.id, e.target.value)} /></td>
            </tr>)}</tbody>
          </table>
        </div>
      )}
      {audit.errors.map((error, i) => <p className="dfw-error" role="alert" key={i}>{error}</p>)}
    </section>
  );
}
