import React, { useEffect, useRef, useState } from "react";
import { HubFilterMenu } from "./DraftHub/HubUILayout.jsx";
import { DFS_SHOWDOWN_COPY as C, formatSalary } from "./dfsToolPresentation.js";
import { approvePairingQb, availablePairingQbs, makeShowdownReview, normalizedBuildStatus, readShowdownReview, showdownAudit, showdownScore } from "./dfsShowdownReview.js";
import { jsonRequest } from "./useDfsBuilder.js";

const score = n => n == null || !Number.isFinite(Number(n)) ? "—" : Number(n).toFixed(2);
const time = value => value && !Number.isNaN(Date.parse(value)) ? new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }) : C.unknown;
const status = row => C.status[normalizedBuildStatus(row)] || normalizedBuildStatus(row);
export function DfsShowdownRules({ b }) {
  if (b.context.site !== "draftkings_showdown") return null;
  const rules = b.settings.showdownRules;
  const policy = rules?.receiver_captain_qb || "warn";
  const qbs = availablePairingQbs(b.pool);
  return <div className="dfw-showdown-rules" data-testid="dfs-showdown-rules">
    <HubFilterMenu label={C.pairing} value={policy} options={C.policies} disabled={b.building} onChange={value => b.changeSetting("showdownRules", { ...(rules || {}), receiver_captain_qb: value, approved_qb_ids: rules?.approved_qb_ids || {} })} />
    <p className="dfw-note">{rules ? C.strategyDefault : C.legacyPolicy}</p>
      {qbs.map(([team, players]) => <HubFilterMenu key={team} label={C.qbChoice(team)} value={rules?.approved_qb_ids?.[team]?.[0] || ""}
        options={[{ id: "", label: C.noQb }, ...players.map(player => ({ id: player.player_id, label: player.Player || player.player,
          detail: player.verified_starting_qb === true || (player.qb_role_verified === true && player.qb_role === "starter") ? C.verified : C.approved }))]}
        disabled={b.building} onChange={id => b.changeSetting("showdownRules", approvePairingQb(rules, team, id))} />)}
    <details><summary>{C.pairingHelp.split(".")[0]}</summary><div className="dfw-detail-body">
      <p className="dfw-note">{C.pairingHelp}</p><p className="dfw-note">{C.explicitApproval}</p>
    </div></details>
  </div>;
}
export function DfsBuildStatusTag({ player }) {
  const key = normalizedBuildStatus(player);
  return <span className={`dfw-player-status is-${key === "out" || key === "ir" ? "unavailable" : ["questionable", "doubtful", "limited"].includes(key) ? "attention" : "neutral"}`}>{C.atBuild}: {status(player)}</span>;
}
export function DfsShowdownPlayerDetails({ player, latest, buildAt, latestPending = false }) {
  const d = player.diagnostics || {};
  const latestTime = latest?.diagnostics?.injury_status_at || latest?.injury_status_at || latest?.availability_updated_at;
  const changed = latest && (normalizedBuildStatus(latest) !== normalizedBuildStatus(player) || latestTime !== d.injury_status_at);
  return <details className="dfw-player-diagnostic"><summary>{C.sourceDetails}</summary><div className="dfw-detail-body">
    <dl className="dfw-showdown-facts">
      <div><dt>{C.atBuild}</dt><dd>{status(player)}<small>{time(d.injury_status_at)}</small></dd></div>
      <div><dt>{latestPending ? C.latestPending : C.latest}</dt><dd>{latest ? status(latest) : C.status.unknown}<small>{time(latestTime)}</small></dd></div>
      <div><dt>{C.source}</dt><dd>{d.source_type || d.projection_source || player.projection_source || C.unknown}</dd></div>
      <div><dt>{C.conditioning}</dt><dd>{C.conditioningLabels[d.availability_conditioning] || C.unknown}</dd></div>
    </dl>
    {!d.current_role_estimate && <p className="dfw-note">{C.noRole}</p>}
    {d.current_role_estimate && <pre>{JSON.stringify(d.current_role_estimate, null, 2)}</pre>}
    {d.role_evidence && <pre>{JSON.stringify(d.role_evidence, null, 2)}</pre>}
    {d.predicted_zero_probability == null && <p className="dfw-note">{C.missingZero}</p>}
    {changed && <p className="dfw-note">{C.beforeBuild}</p>}
    <details><summary>{C.raw}</summary><pre>{JSON.stringify(d, null, 2)}</pre></details>
  </div></details>;
}
export function DfsShowdownScore({ entry, objective, details = false }) {
  const metadata = showdownScore(entry, objective);
  return <div className="dfw-showdown-score">
    <dl className="dfw-showdown-facts">
      <div><dt>{metadata.objective_label}</dt><dd>{score(metadata.objective_score)}<small>{metadata.objective_units}</small></dd></div>
      {metadata.objective_key !== "median" && <div><dt>{C.projection}</dt><dd>{score(metadata.projection_sum)}<small>{metadata.projection_label}</small></dd></div>}
    </dl>
    {!metadata.consistent && <p role="alert" className="dfw-error">{C.scoreMismatch}</p>}
    {details && <details><summary>{C.scoring}</summary><div className="dfw-detail-body"><p className="dfw-note">{metadata.objective_semantics}</p>
      <p className="dfw-note">{metadata.projection_label}</p>
      <dl className="dfw-showdown-facts"><div><dt>{C.forecast}</dt><dd>{metadata.forecast_snapshot_id || C.unknown}</dd></div><div><dt>{C.injurySnapshot}</dt><dd>{metadata.injury_snapshot_id || C.unknown}</dd></div><div><dt>{C.conditioning}</dt><dd>{C.conditioningLabels[metadata.availability_conditioning] || C.unknown}</dd></div></dl>
    </div></details>}
  </div>;
}
export function DfsShowdownFindings({ findings = [] }) {
  const warnings = findings.filter(finding => finding.severity !== "info");
  if (!warnings.length) return null;
  return <details className="dfw-showdown-findings-disclosure"><summary>{C.review}</summary><ul className="dfw-showdown-findings">{warnings.map((finding, index) => <li key={`${finding.code}-${index}`}>
    <strong>{C.warnings[finding.code] || finding.label || String(finding.code).replaceAll("_", " ")}</strong>
    {finding.policy_overridden && <small>{C.exceptionLabel}</small>}
    <small>{finding.suggested_action}</small>
    <details><summary>{C.sourceDetails}</summary><p className="dfw-note">{typeof finding.evidence_basis === "string" ? finding.evidence_basis : JSON.stringify(finding.evidence_basis)}</p></details>
  </li>)}</ul></details>;
}
function ComparedRoster({ row, label, objective, salaryCap = 50000 }) {
  const result = row?.result;
  const statusLabel = C.solver[row?.status] || C.solver.unresolved;
  return <article className="dfw-showdown-completion"><h3>{label}</h3><p className="dfw-note">{statusLabel}</p>
    {result?.lineup && <><DfsShowdownScore entry={result} objective={objective} />
      <dl className="dfw-showdown-facts"><div><dt>{C.salary}</dt><dd>{formatSalary(result.total_salary)}</dd></div><div><dt>{C.unused}</dt><dd>{formatSalary(salaryCap - Number(result.total_salary))}</dd></div></dl>
      <details><summary>{C.inclusion}</summary><div className="dfw-detail-body">{result.lineup.map(player => <div className="dfw-lineup-row" key={player.slot}><small>{player.slot}</small><div><strong>{player.player}</strong><DfsBuildStatusTag player={player} /><small>{player.team} · {player.position}</small></div><span>{formatSalary(player.salary)}</span></div>)}
        <p className="dfw-note">{C.inclusionHelp}</p><DfsShowdownFindings findings={row.findings || showdownAudit(result)} /></div></details>
    </>}
    {row?.reason && <p className="dfw-note">{row.reason}</p>}
  </article>;
}
export default function DfsShowdownReview({ b }) {
  const [playerId, setPlayerId] = useState(""), [slot, setSlot] = useState("flex"), [saved, setSaved] = useState(null), [error, setError] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [savedPage, setSavedPage] = useState(0);
  const epoch = useRef(0), resultRef = useRef(null), importSerial = useRef(0);
  const report = b.playerComparison;
  useEffect(() => { const change = () => { epoch.current++; importSerial.current++; setSaved(null); setError(""); }; window.addEventListener("scoresense-auth-changed", change); return () => { epoch.current++; window.removeEventListener("scoresense-auth-changed", change); }; }, []);
  useEffect(() => { setPlayerId(""); setSaved(null); setError(""); epoch.current++; }, [b.context.site, b.context.slateId, b.context.week, b.currentBuild]);
  useEffect(() => { if (!b.comparing) return; const tick = () => setSeconds(Math.floor((Date.now() - b.comparisonStartedAt) / 1000)); tick(); const timer = setInterval(tick, 1000); return () => clearInterval(timer); }, [b.comparing, b.comparisonStartedAt]);
  useEffect(() => { if (report) resultRef.current?.focus({ preventScroll: true }); }, [report]);
  if (b.context.site !== "draftkings_showdown") return null;
  const build = b.currentBuild;
  const catalog = build?.salaryCatalog || b.pool;
  const names = ids => (ids || []).map(id => catalog.find(p => p.player_id === id)?.Player || id).join(" · ") || "—";
  const save = async () => {
    const version = epoch.current; setError("");
    try {
      const value = { ...makeShowdownReview(build, report), captain_comparison: structuredClone(b.comparison) };
      if ((await jsonRequest("/api/lineup/export-access")).allowed !== true) throw new Error(C.downloadAccess);
      if (version !== epoch.current) throw new Error(C.stale);
      const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
      const link = document.createElement("a"); link.href = url; link.download = "scoresense-showdown-review.json"; link.click(); URL.revokeObjectURL(url);
    } catch (e) { if (version === epoch.current) setError(e.message || C.downloadAccess); }
  };
  return <details className="dfw-panel dfw-flow-disclosure dfw-showdown-review" data-testid="dfs-showdown-review">
    <summary><span className="dfw-summary"><strong>{C.compareTitle}</strong></span></summary>
    <div className="dfw-detail-body">
      <p className="dfw-note">{C.compareHelp}</p>
      {!build?.settings?.build_snapshot && <p className="dfw-note">{C.compareNeedsBuild}</p>}
      <div className="dfw-showdown-compare-controls">
        <HubFilterMenu label={C.comparePlayer} value={playerId} options={[{ id: "", label: C.choosePlayer }, ...catalog.map(p => ({ id: p.player_id, label: p.Player || p.player }))]} onChange={setPlayerId} disabled={b.comparing} />
        <HubFilterMenu label={C.placement} value={slot} options={C.placements} onChange={setSlot} disabled={b.comparing} />
        <button type="button" disabled={!playerId || !build?.settings?.build_snapshot || b.building || b.comparing} onClick={() => b.comparePlayer(playerId, slot)}>{b.comparing ? C.comparing : C.compare}</button>
      </div>
      {b.comparing && <><div className="dfw-actions"><p role="status" className="dfw-note">{C.elapsed(seconds)}</p><button type="button" onClick={b.cancelComparison}>{C.cancel}</button></div><p className="dfw-note">{C.cancelHelp}</p></>}
      {b.comparisonError && <p className="dfw-error" role="alert">{b.comparisonError}</p>}
      {report && <div className="dfw-showdown-comparison-result" ref={resultRef} tabIndex={-1} data-testid="dfs-showdown-comparison">
        <div className="dfw-showdown-completions"><ComparedRoster row={report.baseline} label={C.baseline} objective={report.objective} salaryCap={report.salary_cap ?? build?.settings.salary_cap} /><ComparedRoster row={report.forced} label={C.forced} objective={report.objective} salaryCap={report.salary_cap ?? build?.settings.salary_cap} /></div>
        {report.tradeoff && <details><summary>{C.tradeoffs}</summary><dl className="dfw-showdown-facts"><div><dt>{C.added}</dt><dd>{names(report.tradeoff.added_player_ids)}</dd></div><div><dt>{C.removed}</dt><dd>{names(report.tradeoff.removed_player_ids)}</dd></div><div><dt>{C.objectiveDelta}</dt><dd>{score(report.tradeoff.objective_delta)}</dd></div><div><dt>{C.newWarnings}</dt><dd>{(report.tradeoff.new_warning_codes || []).map(code => C.warnings[code] || code).join(" · ") || "—"}</dd></div><div><dt>{C.removedWarnings}</dt><dd>{(report.tradeoff.removed_warning_codes || []).map(code => C.warnings[code] || code).join(" · ") || "—"}</dd></div></dl></details>}
        <p className="dfw-note">{C.snapshot}: {report.source_snapshot_id?.slice(0, 12)}</p>
        <details><summary>{C.inclusion}</summary><div className="dfw-detail-body"><p className="dfw-note">{C.exposureScope}</p><pre>{JSON.stringify({ snapshot_id: report.source_snapshot_id, objective: build?.settings.objective,
          locked_player_ids: build?.settings.locked_player_ids, excluded_player_ids: build?.settings.excluded_player_ids,
          locked_captain_id: build?.settings.locked_captain_id, max_exposure: build?.settings.max_exposure,
          captain_exposure_limits: build?.settings.captain_exposure_limits, showdown_rules: build?.settings.resolved_showdown_rules || build?.settings.showdown_rules }, null, 2)}</pre></div></details>
      </div>}
      <div className="dfw-actions"><button type="button" disabled={!build?.settings?.build_snapshot || b.comparing} onClick={save}>{C.saveReview}</button>
        <label className="dfw-file-button">{C.reopen}<input type="file" accept=".json,application/json" onChange={async event => {
          const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
          const version = epoch.current, serial = ++importSerial.current;
          try { if (file.size > 8 * 1024 * 1024) throw new Error(C.reviewInvalid); const value = readShowdownReview(await file.text()); if (version === epoch.current && serial === importSerial.current) { setSaved(value); setSavedPage(0); setError(""); } }
          catch (e) { if (version === epoch.current && serial === importSerial.current) setError(e.message); }
        }} /></label></div>
      {error && <p className="dfw-error" role="alert">{error}</p>}
      {saved && <section className="dfw-showdown-saved" data-testid="dfs-showdown-saved"><h3>{C.savedTitle}</h3><p className="dfw-note">{C.savedScope}</p><p className="dfw-note">{time(saved.build.settings.snapshot_at)}</p>
        <details><summary>{C.scoring}</summary>{saved.build.lineups.slice(savedPage * 6, savedPage * 6 + 6).map((entry, i) => <div key={i}><DfsShowdownScore entry={entry} objective={saved.build.settings.objective} details /><div className="dfw-detail-body">{entry.lineup.map(row => <div className="dfw-lineup-row" key={row.slot}><small>{row.slot}</small><div><strong>{row.player}</strong><DfsBuildStatusTag player={row} /></div><span>{formatSalary(row.salary)}</span></div>)}</div></div>)}
          {saved.build.lineups.length > 6 && <div className="dfw-pagination"><span>{savedPage + 1} / {Math.ceil(saved.build.lineups.length / 6)}</span><button disabled={!savedPage} onClick={() => setSavedPage(n => n - 1)}>{C.previous}</button><button disabled={(savedPage + 1) * 6 >= saved.build.lineups.length} onClick={() => setSavedPage(n => n + 1)}>{C.next}</button></div>}
        </details>
        {saved.comparison && <details><summary>{C.compareTitle}</summary><div className="dfw-showdown-completions"><ComparedRoster row={saved.comparison.baseline} label={C.baseline} objective={saved.comparison.objective} salaryCap={saved.comparison.salary_cap ?? saved.build.settings.salary_cap} /><ComparedRoster row={saved.comparison.forced} label={C.forced} objective={saved.comparison.objective} salaryCap={saved.comparison.salary_cap ?? saved.build.settings.salary_cap} /></div></details>}
        <button type="button" onClick={() => setSaved(null)}>{C.closeSaved}</button></section>}
    </div>
  </details>;
}
