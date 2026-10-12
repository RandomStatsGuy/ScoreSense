import React from "react";
import { HubFilterMenu } from "./DraftHub/HubUILayout";
import useDfsContestResearch from "./useDfsContestResearch.js";
import DfsContestPortfolio from "./DfsContestPortfolio.jsx";
import { moneyFraction } from "./dfsContestResearch.js";
import { DFS_CONTEST_COPY as C } from "./dfsToolPresentation.js";
const money = value => `≈${(moneyFraction(value) / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })}`;
const fraction = value => Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "—";
function Values({ rows }) {
  return <dl className="dfw-evidence-values">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}
export default function DfsContestResearch({ shared }) {
  const e = useDfsContestResearch(shared);
  return <details data-testid="dfs-contest-research"><summary>{C.title}</summary>
    <p className="dfw-note">{C.intro}</p>
    {e.unavailable && <p className="dfw-note">{C.selectGames}</p>}
    <label className="dfw-field dfw-scenario-file"><span>{C.file}</span><input type="file" accept=".json,application/json" disabled={e.busy || e.unavailable} onChange={event => { e.readFile(event.target.files?.[0]); event.target.value = ""; }} /></label>
    {e.candidate && <p className="dfw-note">{e.candidate.name}</p>}
    <div className="dfw-review-controls">
      {e.candidate && <button type="button" disabled={e.busy || e.unavailable} onClick={e.runPreview}>{C.preview}</button>}
      {e.preview && <button type="button" disabled={e.busy || e.unavailable || e.previewStale} onClick={e.choose}>{C.use}</button>}
      {e.chosen && <button type="button" disabled={e.busy || e.stale} onClick={e.evaluate}>{C.compare}</button>}
      {e.busy && <button type="button" onClick={e.cancel}>{C.cancel}</button>}
      {e.review && <button type="button" disabled={e.busy} onClick={e.download}>{C.download}</button>}
    </div>
    <p className="dfw-note" role="status">{e.status ? `${e.status} ${e.elapsed}s` : e.chosen ? C.ready : C.idle}</p>
    {e.error && <p className="dfw-error" role="alert">{e.error}</p>}
    {e.stale && <p className="dfw-note">{C.stale}</p>}
    {e.previous && <p className="dfw-note">{C.previous}</p>}
    {e.preview && <Values rows={[[C.contest, e.preview.summary.payout_contract.contest_id], [C.entries, e.preview.summary.payout_contract.entrant_count.toLocaleString()], [C.fee, money({ unit: "USD_cents", numerator: String(e.preview.summary.payout_contract.entry_fee_cents), denominator: "1" })]]} />}
    {e.review && <div data-testid="dfs-contest-results"><h3>{C.results}</h3><p className="dfw-note">{C.assumptionLimit}</p>
      <ul className="dfw-review-list">{e.review.report.assumptions.map(row => <li key={row.scenario_id}>
        <h4>{row.provider} · {row.scenario_id}</h4><p className="dfw-note">{row.injury_assumption}</p>
        <Values rows={[[C.averageNet, money(row.net.mean_cents)], [C.lowNet, money(row.net.p10_cents)], [C.highNet, money(row.net.p90_cents)], [C.topFinish(e.review.report.top_k), fraction(row.sampled_finish_fractions.top_k)]]} />
        <details><summary>{C.moreResults}</summary><Values rows={[[C.averagePayout, money(row.gross.mean_cents)], [C.fees, money(row.fees_cents)], [C.firstTie, fraction(row.sampled_finish_fractions.first_place_tie)], [C.soleFirst, fraction(row.sampled_finish_fractions.sole_first)], [C.cash, fraction(row.sampled_finish_fractions.cash)]]} />
          <p className="dfw-note">{C.sampleHelp}</p>
        </details>
      </li>)}</ul>
    </div>}
    <DfsContestPortfolio shared={shared} contest={e} />
    <details><summary>{C.settings}</summary><div className="dfw-settings-grid dfw-control-fields" data-control-row>
      <div className="dfw-field"><span>{C.draws}</span><HubFilterMenu className="hub-filter-menu--field" label={C.draws} value={String(e.draws)} onChange={v => e.setDraws(Number(v))} options={[32, 64, 128, 256].map(n => ({ id: String(n), label: String(n) }))} /></div>
      <label className="dfw-field"><span>{C.topK}</span><input type="number" min="1" max="100000" value={Number.isNaN(e.topK) ? "" : e.topK} onChange={event => e.setTopK(event.target.value === "" ? NaN : Number(event.target.value))} /></label>
    </div><p className="dfw-note">{C.settingsHelp}</p></details>
    <details><summary>{C.details}</summary><p className="dfw-note">{C.method}</p><p className="dfw-note">{C.rights}</p>
      {(e.review?.preview || e.chosen?.summary || e.preview?.summary)?.warnings.map(w => <p className="dfw-note" key={w}>{w}</p>)}
      {(e.review?.preview || e.chosen?.summary || e.preview?.summary) && <Values rows={[[C.version, (e.review?.preview || e.chosen?.summary || e.preview?.summary).content_id], [C.rounding, C.roundingLabel((e.review?.preview || e.chosen?.summary || e.preview?.summary).payout_contract.tie_policy.rounding)]]} />}
      {(e.review?.preview || e.chosen?.summary || e.preview?.summary)?.field.scenarios.map(row => <article key={row.scenario_id}><h4>{row.provider} · {row.scenario_id}</h4><Values rows={[[C.ownershipScope, C.audience(row.ownership_contest_type)], [C.templateCount, row.unique_template_count], [C.knownOwnership, row.ownership_consistency.known_players], [C.ownershipGap, fraction(row.ownership_consistency.mean_absolute_fraction_gap)]]} /></article>)}
      {(e.review?.preview || e.chosen?.summary || e.preview?.summary)?.field.sources.map(source => <article key={source.source_id}><h4>{source.provider}</h4><Values rows={[[C.source, source.uri], [C.sourceHash, source.content_sha256], [C.sourceKnown, source.known_at]]} /></article>)}
    </details>
  </details>;
}
