import React, { useState } from "react";
import { HubFilterMenu } from "./DraftHub/HubUILayout";
import useDfsSharedOutcomes from "./useDfsSharedOutcomes.js";
import DfsContestResearch from "./DfsContestResearch.jsx";
import { DFS_SHARED_OUTCOMES_COPY as C } from "./dfsToolPresentation.js";

const num = value => Number.isFinite(value) ? value.toFixed(2) : "—";
const percent = value => Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "—";
function Values({ rows }) {
  return <dl className="dfw-evidence-values">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value ?? "—"}</dd></div>)}</dl>;
}
function Pager({ page, count, onChange }) {
  if (count <= 1) return null;
  return <div className="dfw-review-controls"><button type="button" disabled={!page} onClick={() => onChange(page - 1)}>{C.previousPage}</button><span>{page + 1} / {count}</span><button type="button" disabled={page + 1 >= count} onClick={() => onChange(page + 1)}>{C.nextPage}</button></div>;
}
function Results({ review }) {
  const [page, setPage] = useState(0), [playerPage, setPlayerPage] = useState(0), [search, setSearch] = useState("");
  const { report, snapshot } = review;
  const index = new Map(snapshot.lineups.map((lineup, i) => [lineup.lineup_id, i]));
  const playerById = new Map(snapshot.pool.map(player => [player.player_id, player]));
  const name = pid => snapshot.player_labels?.[pid] || pid;
  const players = report.players.filter(player => `${name(player.player_id)} ${playerById.get(player.player_id)?.team}`.toLowerCase().includes(search.toLowerCase()));
  const currentPage = Math.min(page, Math.max(0, Math.ceil(report.lineups.length / 8) - 1));
  const currentPlayerPage = Math.min(playerPage, Math.max(0, Math.ceil(players.length / 16) - 1));
  return <div data-testid="dfs-shared-results">
    <h3>{C.results}</h3>
    <p className="dfw-note">{report.lineups.length} {C.lineupCount.toLowerCase()} · {report.draw_count} {C.draws.toLowerCase()}</p>
    <ul className="dfw-review-list">{report.lineups.slice(currentPage * 8, currentPage * 8 + 8).map(lineup => <li key={lineup.lineup_id}>
      <h4>{snapshot.labels[index.get(lineup.lineup_id)] || lineup.lineup_id}</h4>
      <Values rows={[[C.mean, num(lineup.mean)], [C.p10, num(lineup.p10)], [C.p50, num(lineup.p50)], [C.p90, num(lineup.p90)], [C.delta, num(lineup.paired_delta_mean_vs_first)]]} />
      <details><summary>{C.roster}</summary><ol>{lineup.player_ids.map(pid => <li key={pid}>{playerById.get(pid)?.position} · {name(pid)} · {playerById.get(pid)?.team}</li>)}</ol>
        <Values rows={[[C.zero, percent(lineup.zero_fraction)], [C.negative, percent(lineup.negative_fraction)], [C.min, num(lineup.min)], [C.max, num(lineup.max)]]} />
      </details>
    </li>)}</ul>
    <Pager page={currentPage} count={Math.ceil(report.lineups.length / 8)} onChange={setPage} />
    <details><summary>{C.playerResults}</summary>
      <label className="dfw-field"><span>{C.search}</span><input value={search} onChange={event => { setSearch(event.target.value); setPlayerPage(0); }} /></label>
      <ul className="dfw-review-list">{players.slice(currentPlayerPage * 16, currentPlayerPage * 16 + 16).map(player => <li key={player.player_id}><h4>{name(player.player_id)}</h4><Values rows={[[C.mean, num(player.mean)], [C.p10, num(player.p10)], [C.p50, num(player.p50)], [C.p90, num(player.p90)], [C.zero, percent(player.zero_fraction)], [C.negative, percent(player.negative_fraction)]]} /></li>)}</ul>
      {!players.length && <p className="dfw-note">{C.noRows}</p>}
      <Pager page={currentPlayerPage} count={Math.ceil(players.length / 16)} onChange={setPlayerPage} />
    </details>
  </div>;
}
function Receipts({ preview, snapshot, report, title = C.audit }) {
  if (!preview) return null;
  return <details><summary>{title}</summary>
    <p className="dfw-note">{C.method}</p><p className="dfw-note">{C.limitations}</p>
    <Values rows={[[C.bank, preview.content_id], [C.scoring, preview.scoring_version], [C.decision, preview.decision_at], [C.scopeLabel, preview.evidence_scope],
      ...(snapshot ? [[C.snapshot, snapshot.input_snapshot_id], [C.frozen, snapshot.selected_at]] : []),
      ...(report ? [[C.conservation, report.audit.conservation_passed ? C.passed : C.unknown], [C.gameDraws, report.audit.game_draws], [C.poolCount, report.audit.pool_players_covered], [C.runtime, `${num(report.runtime_seconds)}s`]] : [])]} />
    {preview.scoring_source && <Values rows={[[C.scoring, preview.scoring_source.version || preview.scoring_version], [C.source, preview.scoring_source.uri || preview.scoring_source.url || C.unknown], [C.hash, preview.scoring_source.content_sha256 || preview.scoring_source.response_sha256 || C.unknown]]} />}
    {(preview.sources || []).map(source => <article key={source.source_id}><h4>{source.provider} · {source.source_id}</h4>
      <Values rows={[[C.source, source.uri], [C.hash, source.content_sha256], [C.period, JSON.stringify(source.period)], [C.published, source.published_at ?? C.unknown], [C.known, source.known_at ?? C.unknown], [C.retrieved, source.retrieved_at ?? C.unknown],
        [C.definition, typeof source.definition === "string" ? source.definition : C.unknown], [C.units, typeof source.units === "string" ? source.units : C.unknown],
        ...Object.entries(source.rights || {}).map(([right, allowed]) => [`${C.rights}: ${right.replaceAll("_", " ")}`, allowed === true ? C.allowed : allowed === false ? C.denied : C.unknown])]} />
    </article>)}
    {(report?.warnings || preview.warnings || []).map(warning => <p className="dfw-note" key={warning}>{warning}</p>)}
    <p className="dfw-note">{C.exportHelp}</p>
  </details>;
}
export default function DfsSharedOutcomesReview({ b }) {
  const e = useDfsSharedOutcomes(b);
  const resultKey = e.review ? `${e.review.snapshot.input_snapshot_id}:${e.review.report.stream_manifest.draw_content_id}` : "";
  return <details className="dfw-shared-review" data-testid="dfs-shared-review"><summary>{C.title}</summary>
    <p className="dfw-note">{C.intro}</p><p className="dfw-note">{C.research}</p>
    <div className="dfw-review-controls">
      <HubFilterMenu label={C.scope} value={e.scope} onChange={e.setScope} options={[{ id: "build", label: C.build }, { id: "collection", label: C.collection }]} />
      <label className="dfw-field dfw-scenario-file"><span>{C.file}</span><input type="file" accept=".json,application/json" disabled={e.busy || Boolean(e.inputError)} onChange={event => { e.readFile(event.target.files?.[0]); event.target.value = ""; }} /></label>
    </div>
    <p className="dfw-note">{C.fileHelp}</p>
    {e.candidate && <p className="dfw-note">{C.fileSelected(e.candidate.name)}</p>}
    <details><summary>{C.settings}</summary><div className="dfw-settings-grid dfw-control-fields" data-control-row>
      <label className="dfw-field"><span>{C.seed}</span><input type="number" min="0" max="2147483647" step="1" value={Number.isNaN(e.seed) ? "" : e.seed} onChange={event => e.setSeed(event.target.value === "" ? NaN : Number(event.target.value))} /></label>
      <div className="dfw-field"><span>{C.draws}</span><HubFilterMenu className="hub-filter-menu--field" label={C.draws} value={String(e.drawCount)} onChange={value => e.setDrawCount(Number(value))} options={[32, 64, 128, 256, 512, 1024].map(n => ({ id: String(n), label: String(n) }))} /></div>
    </div></details>
    <div className="dfw-review-controls">
      {e.candidate && <button type="button" onClick={e.runPreview} disabled={e.busy || Boolean(e.inputError)}>{C.preview}</button>}
      {e.preview && <button type="button" onClick={e.select} disabled={e.busy || e.previewStale || Boolean(e.inputError)}>{C.use}</button>}
      {e.selected && <button type="button" onClick={e.evaluate} disabled={e.busy || e.stale || !e.selected.snapshot.lineups.length}>{C.evaluate}</button>}
      {e.busy && <button type="button" onClick={e.cancel}>{C.cancel}</button>}
      {e.review && <button type="button" onClick={e.download} disabled={e.busy}>{C.download}</button>}
    </div>
    <p className="dfw-note" role="status" data-testid="dfs-shared-status">{e.busy ? `${C[e.status]} ${C.elapsed(e.elapsed)}` : e.notice || (e.candidate ? `${e.candidate.name} · ${C.ready}` : C.idle)}</p>
    {e.inputError && <p className="dfw-note">{e.inputError}</p>}
    {e.error && <p className="dfw-error" role="alert">{e.error}</p>}
    {e.preview && <p className="dfw-note">{C.counts(e.preview.summary.counts)}</p>}
    {e.previewStale && <p className="dfw-note" role="status">{C.previewStale}</p>}
    {e.selected && <p className="dfw-note">{C.selectedSummary(e.selected.name, e.selected.snapshot.lineups.length)}</p>}
    {e.selected && !e.selected.snapshot.lineups.length && <p className="dfw-note">{C.buildFirst}</p>}
    {e.stale && <p className="dfw-note" role="status">{C.stale}</p>}
    {e.previousReview && <p className="dfw-note" role="status">{C.previous}</p>}
    {e.review && <Results key={resultKey} review={e.review} />}
    {e.preview && (e.review || e.selected) && e.preview.summary.content_id !== (e.review?.preview || e.selected?.summary)?.content_id && <Receipts title={C.previewDetails} preview={e.preview.summary} />}
    <DfsContestResearch shared={e} />
    <Receipts preview={e.review?.preview || e.selected?.summary || e.preview?.summary} snapshot={e.review?.snapshot || e.selected?.snapshot} report={e.review?.report} />
  </details>;
}
