import React, { useMemo, useState } from "react";
import useDfsEvidence from "./useDfsEvidence.js";
import { commonSnapshotScores, eligibleEvidenceGames, primaryQbScope, portableComparisonReview } from "./dfsEvidence.js";
import { HubFilterMenu } from "./DraftHub/HubUILayout";
import { DFS_EVIDENCE_COPY as C, normalizeDfsTeam } from "./dfsToolPresentation.js";

const num = value => value == null || !Number.isFinite(Number(value)) ? "—" : Number(value).toFixed(1);
const percent = value => value == null ? "—" : `${(value * 100).toFixed(1)}%`;
const clock = value => value ? value : C.unavailable;
const shortId = value => value ? value.slice(0, 18) : "—";
const salary = value => value == null || !Number.isFinite(Number(value)) ? "—" : `$${Number(value).toLocaleString()}`;
function Values({ rows }) { return <dl className="dfw-evidence-values">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value ?? "—"}</dd></div>)}</dl>; }
function Pager({ page, count, setPage }) { return <div className="dfw-review-controls"><button type="button" disabled={!page} onClick={() => setPage(page - 1)}>{C.previous}</button><span>{page + 1} / {Math.max(1, count)}</span><button type="button" disabled={page + 1 >= count} onClick={() => setPage(page + 1)}>{C.next}</button></div>; }

function Candidate({ candidate, emphasis }) {
  const rules = candidate.classic_stack_rules;
  return <details className="dfw-evidence-candidate" data-testid="dfs-evidence-candidate">
    <summary><span>{emphasis && <strong>{emphasis} · </strong>}{candidate.qb_name || candidate.qb_id} · {C.controlSummary(rules?.attachments, C.labels.attachments)} · {C.controlSummary(rules?.bring_back, C.labels.bringBack)}</span><b>{num(candidate.objective_score)}</b></summary>
    <p className="dfw-note">{candidate.in_primary_scope ? "Primary QB focus" : "Excluded QB alternative"} · {candidate.status === "infeasible" ? C.conflicting : candidate.status === "not_evaluated" ? C.notEvaluated : candidate.status} · {candidate.completions?.length || 0} complete rosters · Gap from best evaluated: {num(candidate.gap_from_best_evaluated)}</p>
    {candidate.reason && <p className="dfw-note">{candidate.reason}</p>}
    <Values rows={[[C.labels.actualAttachments, candidate.stack_audit?.attachments?.relationship_known === true ? candidate.stack_audit.attachments.actual_count : C.unavailable], [C.labels.actualBringBack, candidate.stack_audit?.bring_back?.relationship_known === true ? candidate.stack_audit.bring_back.actual_count : C.unavailable], [C.labels.receivingEligibility, rules?.attachments?.receiving_rb_ids?.join(", ") || C.labels.noReceivingRbs]]} />
    {(candidate.completions || []).map((item, index) => <div className="dfw-evidence-roster" key={index}>
      <p><strong>Completion {index + 1}</strong> · {C.score}: {num(item.objective_score)} · Salary: {salary(item.result?.salary_used ?? item.result?.total_salary)} · {item.status}</p>
      <ol>{(item.result?.lineup || []).map(player => <li key={player.player_id}><span>{player.slot || player.position} · {player.player || player.name || player.Player || player.player_id}</span><span>{salary(player.salary)}</span></li>)}</ol>
    </div>)}
  </details>;
}

export default function DfsEvidenceReview({ b, panelRef, onReturn }) {
  const e = useDfsEvidence(b);
  const [scope, setScope] = useState("all"), [search, setSearch] = useState(""), [position, setPosition] = useState("all");
  const [page, setPage] = useState(0), [comparisonPage, setComparisonPage] = useState(0);
  const [gamePage, setGamePage] = useState(0);
  // Evidence is staged on refresh; selected comparisons always retain their own
  // frozen document. Never silently mix newest observations with old scores.
  const view = e.selected ? e.selected.evidence : e.evidence;
  const viewPool = e.selected ? e.selected.pool.map(p => ({ ...p, Team: p.team, Opponent: p.opponent, Position: p.position, Player: p.name })) : b.pool || [];
  const eligible = eligibleEvidenceGames(view, viewPool);
  const qbs = viewPool.filter(p => p.Position === "QB");
  let qbScope = { teams: [], qbIds: [] };
  try { qbScope = primaryQbScope(b); } catch { /* selection explains invalid focus */ }
  if (e.selected) qbScope = { teams: e.selected.stack_teams, qbIds: e.selected.stack_qb_ids };
  const primary = qb => qbScope.qbIds?.length ? qbScope.qbIds.includes(qb.player_id) : !qbScope.teams?.length || qbScope.teams.includes(normalizeDfsTeam(qb.Team));
  const games = eligible.filter(game => scope === "all" || qbs.some(qb => [game.home, game.away].includes(normalizeDfsTeam(qb.Team)) && primary(qb) === (scope === "primary")));
  const gamesPage = Math.min(gamePage, Math.max(0, Math.ceil(games.length / 4) - 1));
  const catalog = new Map(viewPool.map(p => [p.player_id, p]));
  const players = (view?.players || []).filter(p => catalog.has(p.canonical_id) && (position === "all" || p.position === position) &&
    `${catalog.get(p.canonical_id)?.Player || p.canonical_id} ${p.team}`.toLowerCase().includes(search.toLowerCase()));
  const playerPage = Math.min(page, Math.max(0, Math.ceil(players.length / 8) - 1));
  const candidates = e.report?.candidates || [];
  const featured = [e.report?.best_primary_id, e.report?.best_challenger_id].filter(Boolean);
  const rest = candidates.filter(candidate => !featured.includes(candidate.id));
  const comparisonsPage = Math.min(comparisonPage, Math.max(0, Math.ceil(rest.length / 6) - 1));
  const common = useMemo(() => commonSnapshotScores(e.selected, b.portfolio), [e.selected, b.portfolio]);
  const download = () => {
    const blob = new Blob([JSON.stringify(portableComparisonReview(e.selected, e.report, common), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob), a = document.createElement("a"); a.href = url; a.download = "scoresense-comparison-review.json"; a.click(); URL.revokeObjectURL(url);
  };
  return <section ref={panelRef} tabIndex={-1} className="dfw-panel dfw-evidence-review" aria-label={C.title} data-testid="dfs-evidence-review">
    <div className="dfw-panel-head"><div><h2>{C.title}</h2><p className="dfw-note">{C.intro}</p></div>{onReturn && <button type="button" onClick={onReturn}>{C.return}</button>}</div>
    <div className="dfw-review-controls"><button type="button" onClick={e.refresh} disabled={e.status === "loading"}>{C.refresh}</button>
      <button type="button" onClick={e.select} disabled={e.selecting || Boolean(e.inputError)}>{C.select}</button>
      {e.selected && <button type="button" onClick={e.compare} disabled={e.stale || e.comparing}>{e.comparing ? C.progress : C.compare}</button>}
      {e.comparing && <><span role="status">{C.elapsed(e.elapsed)}</span><button type="button" onClick={e.cancel}>{C.cancel}</button></>}
      {e.selected && <button type="button" onClick={download}>{C.download}</button>}</div>
    <p className="dfw-note" role="status" data-testid="dfs-evidence-status">{e.status === "loading" ? C.loading : view?.status === "available" ? eligible.length ? `${view?.evidence_scope === "live" ? C.live : C.retrospective} · ${eligible.length} games` : C.noEligibleGames : e.status === "error" ? C.failed : e.selected ? C.selectedWithoutEvidence : C.missing}</p>
    {e.inputError && <p className="dfw-note">{e.inputError}</p>}
    {e.error && <p className="dfw-error" role="alert">{e.error}</p>}
    {e.notice && <p className="dfw-note" role="status">{e.notice}</p>}
    {e.newest && <p className="dfw-input-update" role="status">{C.newest}</p>}
    {e.stale && <p className="dfw-note" role="status">{C.stale}</p>}
    {e.selected && <details><summary>{C.selected}</summary><Values rows={[[C.selected, shortId(e.selected.input_snapshot_id)], [C.labels.frozenAt, e.selected.frozen_at], [C.labels.evidenceVersion, shortId(e.selected.evidence_id)], [C.labels.objective, e.selected.objective], [C.labels.inputCount, e.selected.pool.length]]} /></details>}
    <details><summary>{C.games}{eligible.length ? ` · ${eligible.length}` : ""}</summary>
      <details><summary>{C.gameHelp}</summary><p className="dfw-note">{C.pace}</p><p className="dfw-note">{C.scope}</p></details>
      <HubFilterMenu label={C.labels.gameScope} value={scope} onChange={value => { setScope(value); setGamePage(0); }} options={[{ id: "all", label: C.allGames }, { id: "primary", label: C.primaryGames }, { id: "challenger", label: C.challengerGames }]} />
      <div className="dfw-evidence-games">{games.slice(gamesPage * 4, gamesPage * 4 + 4).map(game => <details key={game.game_id} data-testid="dfs-evidence-game"><summary>{game.away} at {game.home} · Plays: {num(game.team_screens[game.away].plays_screen)} / {num(game.team_screens[game.home].plays_screen)} · Combined: {num(game.combined_play_screen)}</summary><p className="dfw-note">{game.game_id} · {clock(game.kickoff_at)}</p>
        <Values rows={[[C.labels.combinedPlays, num(game.combined_play_screen)]]} />
        <div className="dfw-evidence-sides">{[game.away, game.home].map(team => { const s = game.team_screens[team]; return <section key={team} aria-label={`${team} volume evidence`}><h4>{team}</h4>
          <Values rows={[[C.labels.playScreen, num(s.plays_screen)], [C.labels.dropbackScreen, num(s.dropbacks_screen)], [C.labels.dropbackRate, percent(s.dropback_rate)], [C.labels.sample, `${s.season_games} / ${s.venue_games}`], [C.labels.seasonCounts, `${num(s.season_for)} / ${num(s.season_against)}`], [C.labels.venueCounts, `${num(s.venue_for)} / ${num(s.venue_against)}`], [C.labels.seasonAlternative, num(s.alternatives?.season_only)], [C.labels.venueAlternative, num(s.alternatives?.venue_only)], [C.labels.pooledAlternative, num(s.alternatives?.pooled_venue)]]} />
          {s.fallback_reason && <p className="dfw-note">{s.fallback_reason}</p>}<p className="dfw-note">Observed through: {clock(s.observed_through)} · Sources: {s.source_ids?.join(", ") || C.unavailable}</p>
        </section>; })}</div></details>)}</div>
      {!games.length && <p className="dfw-note">{C.noRows}</p>}
      {games.length > 4 && <Pager page={gamesPage} count={Math.ceil(games.length / 4)} setPage={setGamePage} />}
    </details>
    <details><summary>{C.players}</summary><details><summary>{C.roleHelp}</summary><p className="dfw-note">{C.observed}</p><p className="dfw-note">{C.specialist}</p></details>
      <div className="dfw-review-controls"><label className="dfw-field"><span>{C.search}</span><input value={search} onChange={event => { setSearch(event.target.value); setPage(0); }} /></label><HubFilterMenu label={C.position} value={position} onChange={value => { setPosition(value); setPage(0); }} options={["all", "QB", "RB", "WR", "TE", "DST"].map(p => ({ id: p, label: p === "all" ? C.labels.allPositions : p }))} /></div>
      <ul className="dfw-review-list">{players.slice(playerPage * 8, playerPage * 8 + 8).map(player => <li key={player.canonical_id}><h3>{catalog.get(player.canonical_id)?.Player || player.canonical_id} · {player.position} · {player.team}</h3>
        <Values rows={[[C.labels.observedGames, player.observed_games], [C.labels.targets, `${player.targets ?? "—"} / ${player.team_targets ?? "—"}`], [C.labels.targetShare, percent(player.target_share)], [C.labels.carries, `${player.carries ?? "—"} / ${player.team_carries ?? "—"}`], [C.labels.carryShare, percent(player.carry_share)], [C.labels.routes, player.routes ?? C.unavailable], [C.labels.teamRouteRate, player.route_participation == null ? C.unavailable : percent(player.route_participation)]]} />
        {(player.route_observations || []).map((observation, index) => <details key={`${observation.source_id}:${index}`}><summary>{observation.source_id} · {JSON.stringify(observation.period)}</summary><Values rows={[[C.labels.routes, observation.routes], [C.labels.playerPassSnaps, observation.player_pass_snaps], [C.labels.teamDropbacks, observation.team_dropbacks], [C.labels.playerRouteRate, percent(observation.player_pass_snap_route_rate)], [C.labels.teamRouteRate, percent(observation.team_dropback_route_participation)], [C.labels.receivingGrade, observation.receiving_grade]]} /></details>)}
        <p className="dfw-note">{player.reason} Sources: {player.source_ids?.join(", ") || C.unavailable}</p></li>)}</ul>
      {!players.length && <p className="dfw-note">{C.noRows}</p>}{players.length > 8 && <Pager page={playerPage} count={Math.ceil(players.length / 8)} setPage={setPage} />}
    </details>
    <details open={Boolean(e.report)}><summary>{C.comparisons}</summary><details><summary>{C.comparisonHelp}</summary><p className="dfw-note">{C.semantics}</p><p className="dfw-note">{C.controls}</p><p className="dfw-note">{C.bounded}</p></details>
      {e.report && <p className="dfw-note">{C.snapshot}: {shortId(e.report.snapshot_id)} · {e.report.attempt_count} solves · {e.report.runtime_seconds}s · {e.report.complete ? "All requested first completions resolved" : "Partial evaluation; unresolved alternatives remain"}</p>}
      {featured.map(id => { const candidate = candidates.find(c => c.id === id); return candidate && <Candidate key={id} candidate={candidate} emphasis={id === e.report.best_challenger_id ? C.labels.bestChallenger : C.labels.bestPrimary} />; })}
      {rest.slice(comparisonsPage * 6, comparisonsPage * 6 + 6).map(candidate => <Candidate key={candidate.id} candidate={candidate} />)}
      {!e.report && <p className="dfw-note">{C.emptyComparison}</p>}{rest.length > 6 && <Pager page={comparisonsPage} count={Math.ceil(rest.length / 6)} setPage={setComparisonPage} />}
      {Boolean(common.length) && <details><summary>{C.currentScores}</summary><p className="dfw-note">{C.unchanged}</p><ul className="dfw-review-list">{common.slice(0, 20).map(row => <li key={`${row.batch_id}:${row.lineup_index}`}>{row.label} · Lineup {row.lineup_index + 1} · {row.status === "available" ? `${C.score}: ${num(row.objective_score)}` : `${C.unavailable}: ${row.missing_ids.join(", ")}`}</li>)}</ul>{common.length > 20 && <p className="dfw-note">Showing 20 of {common.length}; the downloaded review includes all comparisons.</p>}</details>}
    </details>
    <details><summary>{C.sources}</summary><p className="dfw-note">{C.sourceHelp}</p><p className="dfw-note">{C.timingHelp}</p><p className="dfw-note">{view?.play_definition?.description || C.unavailable}</p>
      <p className="dfw-note">{view?.play_definition?.identities?.join(" · ")}</p>
      <p className="dfw-note">Evidence cutoff: {clock(view?.decision_at)}. {e.selected?.projection_provenance}</p>
      {(view?.sources || []).map(source => <article key={source.source_id}><h3>{source.provider} · {source.source_id}</h3><Values rows={[[C.labels.sourceUri, source.uri], [C.labels.hash, source.content_sha256], [C.labels.period, JSON.stringify(source.period)], [C.labels.definition, `${source.definition} / ${source.units || C.unavailable}`], [C.labels.filters, source.raw_filters || C.unavailable], [C.labels.publication, clock(source.published_at)], [C.labels.retrieved, clock(source.retrieved_at)], [C.labels.knownAt, clock(source.known_at)], [C.labels.revision, source.revision || C.unavailable], ...Object.entries(source.rights || {}).map(([key, value]) => [key.replaceAll("_", " "), value === true ? C.labels.allowed : value === false ? C.labels.denied : C.labels.unknown])]} /></article>)}
      {(view?.warnings || []).map(warning => <p className="dfw-note" key={warning}>{warning}</p>)}
    </details>
  </section>;
}
