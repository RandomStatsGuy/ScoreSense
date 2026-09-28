import React, { useEffect, useState } from "react";
import { DFS_WORKSPACE_COPY as C, dfsPoolFreshness } from "./dfsToolPresentation";

export function DfsPoolFreshness({ b }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer); }, []);
  const status = dfsPoolFreshness({ ...b.poolFreshness, ...b.context, busy: b.busy, now });
  return <div className={`dfw-freshness is-${status.tone}`} role="status">
    <div><strong>{status.label}</strong>{status.detail && <small>{status.detail}</small>}</div>
    {b.lineups.length > 0 && <small>{C.originalInputs}</small>}
  </div>;
}

export function DfsSourceSummary({ coverage }) {
  return <section className="dfw-panel dfw-source-summary" aria-labelledby="dfw-source-title">
    <div><h2 id="dfw-source-title">{C.sourceTitle}</h2><p className="dfw-note">{C.sourceScope}</p></div>
    {!coverage.available.length ? <p className="dfw-note">{C.sourcesEmpty}</p> : <dl>
      {Object.entries(C.sourceDescriptions).filter(([source]) => coverage.sources[source]).map(([source, description]) => <div key={source}>
        <dt>{source}<small>{description}</small></dt><dd>{coverage.sources[source]}</dd>
      </div>)}
    </dl>}
    <details><summary>{C.rangeHint}</summary><p className="dfw-note">{C.missingProjection}</p></details>
  </section>;
}

export default function DfsPoolCoverage({ coverage, busy, onUnavailable, importControl }) {
  const [review, setReview] = useState(false);
  return <div className="dfw-pool-coverage" aria-busy={busy}>
    <div className="dfw-coverage-strip">
      <div><strong>{busy ? C.loading : C.availableCount(coverage.available.length)}</strong><small>{C.coverageHelp}</small></div>
      <div className="dfw-coverage-actions">
        <button type="button" onClick={onUnavailable} disabled={busy || !coverage.unavailable.length}>{C.unavailableCount(coverage.unavailable.length)}</button>
        <button type="button" className={coverage.missing.length ? "dfw-needs-estimates" : ""} disabled={busy} aria-expanded={review} aria-controls="dfw-missing-estimates" onClick={() => setReview(value => !value)}>{C.missingCount(coverage.missing.length)}</button>
      </div>
    </div>
    {review && <section id="dfw-missing-estimates" className="dfw-missing-estimates" aria-label={C.missingTitle}>
      <h3>{C.missingTitle}</h3>
      {!coverage.missing.length ? <p className="dfw-note">{C.missingEmpty}</p> : <ul>
        {coverage.missing.map(player => <li key={player.player_id}><div><strong>{player.Player}</strong><small>{player.Team} · {player.Position}</small></div><p>{C.missingReasons[player.projection_missing_reason] || C.missingReasons.missing_or_invalid_projection}</p></li>)}
      </ul>}
      {importControl}
    </section>}
  </div>;
}
