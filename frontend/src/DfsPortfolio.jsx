import React, { useMemo, useRef, useState } from "react";
import { auditPortfolio } from "./dfsPortfolio.js";
import { DFS_PORTFOLIO_COPY as C, DFS_WORKFLOW_COPY as W } from "./dfsToolPresentation.js";
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
  const panelRef = useRef(null);
  const audit = useMemo(() => auditPortfolio(b.portfolio, b.portfolioLimits, b.portfolioRules), [b.portfolio, b.portfolioLimits, b.portfolioRules]);
  const hasPortfolio = b.portfolio.length > 0;
  const hasBuild = Boolean(b.currentBuild?.lineups?.length);
  return (
    <section ref={panelRef} tabIndex={-1} className="dfw-panel dfw-classic-portfolio" aria-labelledby="dfw-portfolio-title">
      <h2 id="dfw-portfolio-title">{C.title}</h2>
      {!hasPortfolio && <p className="dfw-note">{hasBuild ? C.emptyWithBuild : C.empty}</p>}
      {hasBuild && !hasPortfolio && <button type="button" data-testid="dfs-save-set" disabled={disabled || b.busy || b.building || b.currentBuild.context.site !== "draftkings"}
        onClick={() => { if (b.addPortfolioBatch(W.firstBatch)) requestAnimationFrame(() => panelRef.current?.focus({ preventScroll: true })); }}>{C.saveSet}</button>}
      {hasPortfolio && <div className="dfw-portfolio-progress">
        <p role="status">{R.setProgress(audit.unique, audit.requestedCount)}</p>
        <meter min="0" max={Math.max(1, audit.requestedCount)} value={Math.min(audit.requestedCount, audit.unique)} aria-label={C.title} />
      </div>}
      {children && <details className="dfw-portfolio-recovery" open={!hasPortfolio}><summary>{C.saveRestore}</summary>{children}</details>}
      {(hasBuild || hasPortfolio) && <details className="dfw-batch-details" data-testid="dfs-portfolio-batches"><summary>{C.batchDetails}</summary>
      <p className="dfw-note">{C.help}</p>
      {hasPortfolio && <p className="dfw-note">{R.progress(audit.unique, audit.total, audit.requestedCount, audit.batchCount, audit.duplicates.length)}</p>}
      <div className="dfw-actions dfw-batch-actions">
        <label className="dfw-field">
          <span>{C.label}</span>
          <input value={label} maxLength={100} onChange={e => setLabel(e.target.value)} disabled={disabled} />
        </label>
        <button type="button" disabled={disabled || b.busy || b.building || !hasBuild || !label.trim() || b.currentBuild?.context.site !== "draftkings"}
          onClick={() => { if (b.addPortfolioBatch(label)) setLabel(""); }}>{C.add}</button>
      </div>
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
      </details>}
      {audit.duplicates.map(d => <p className="dfw-error" role="alert" key={d.index}>{C.duplicate(d.first, d.index, d.batch)}</p>)}
      {hasPortfolio && <DfsPortfolioReview b={b} audit={audit} disabled={disabled} />}
      {audit.errors.map((error, i) => <p className="dfw-error" role="alert" key={i}>{error}</p>)}
    </section>
  );
}
