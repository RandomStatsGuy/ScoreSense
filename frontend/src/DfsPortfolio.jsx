import React, { useMemo, useState } from "react";
import { auditPortfolio } from "./dfsPortfolio.js";
import { DFS_PORTFOLIO_COPY as C } from "./dfsToolPresentation.js";
import DfsPortfolioReview from "./DfsPortfolioReview.jsx";
import { DFS_REVIEW_COPY as R } from "./dfsPortfolioReviewPresentation.js";

function BatchLineups({ batch }) {
  const [page, setPage] = useState(0), pages = Math.ceil(batch.lineups.length / 5), visiblePage = Math.min(page, Math.max(0, pages - 1));
  return <><ol start={visiblePage * 5 + 1}>{batch.lineups.slice(visiblePage * 5, visiblePage * 5 + 5).map((entry, index) => <li key={visiblePage * 5 + index}>
    <p className="dfw-note">{entry.lineup.map(p => `${p.slot} ${p.player}`).join(" · ")}</p></li>)}</ol>
    {pages > 1 && <div className="dfw-pagination"><span>{visiblePage + 1} / {pages}</span>
      <button type="button" disabled={!visiblePage} onClick={() => setPage(visiblePage - 1)}>{R.previous}</button>
      <button type="button" disabled={visiblePage + 1 >= pages} onClick={() => setPage(visiblePage + 1)}>{R.next}</button></div>}</>;
}

export default function DfsPortfolio({ b, disabled = false, children }) {
  const [label, setLabel] = useState("");
  const audit = useMemo(() => auditPortfolio(b.portfolio, b.portfolioLimits, b.portfolioRules), [b.portfolio, b.portfolioLimits, b.portfolioRules]);
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
        <p role="status">{R.progress(audit.unique, audit.total, audit.requestedCount, audit.batchCount, audit.duplicates.length)}</p>
        <meter min="0" max={Math.max(1, audit.requestedCount)} value={Math.min(audit.requestedCount, audit.unique)} aria-label={C.title} />
      </div>
      {!b.portfolio.length && <p className="dfw-note">{C.empty}</p>}
      {b.portfolio.map(batch => (
        <div key={batch.id}>
          <div className="dfw-panel-head">
            <details>
              <summary>{C.batchSummary(batch.label, batch.lineups.length, batch.settings.snapshot_at)}</summary>
              <p className="dfw-note">{batch.slateName}</p>
              <BatchLineups batch={batch} />
            </details>
            <button type="button" disabled={disabled} aria-label={`${C.remove}: ${batch.label}`} onClick={() => b.removePortfolioBatch(batch.id)}>{C.remove}</button>
          </div>
        </div>
      ))}
      {audit.duplicates.map(d => <p className="dfw-error" key={d.index}>{C.duplicate(d.first, d.index, d.batch)}</p>)}
      <DfsPortfolioReview b={b} audit={audit} disabled={disabled} />
      {audit.errors.map((error, i) => <p className="dfw-error" role="alert" key={i}>{error}</p>)}
    </section>
  );
}
