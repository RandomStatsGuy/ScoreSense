import React, { useId, useMemo, useRef, useState } from "react";
import { HubFilterMenu } from "./DraftHub/HubUILayout.jsx";
import { portfolioSupportingLineups, previewPortfolioReplacement } from "./dfsPortfolioReview.js";
import { DFS_REVIEW_COPY as C } from "./dfsPortfolioReviewPresentation.js";

const number = value => value == null ? "—" : Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
function Pager({ page, pages, onChange }) {
  if (pages < 2) return null;
  return <div className="dfw-pagination"><span>{page + 1} / {pages}</span>
    <button type="button" disabled={!page} onClick={() => onChange(page - 1)}>{C.previous}</button>
    <button type="button" disabled={page + 1 >= pages} onClick={() => onChange(page + 1)}>{C.next}</button></div>;
}
function BoundedList({ rows, render, size = 6 }) {
  const [page, setPage] = useState(0), pages = Math.ceil(rows.length / size), visiblePage = Math.min(page, Math.max(0, pages - 1));
  return <><ul className="dfw-review-list">{rows.slice(visiblePage * size, (visiblePage + 1) * size).map(render)}</ul>
    <Pager page={visiblePage} pages={pages} onChange={setPage} /></>;
}
function Bounds({ rule = {}, name, actual, disabled, onChange }) {
  const fieldId = useId();
  const invalid = kind => {
    const value = rule[kind]; if (value == null || value === "") return false;
    const n = Number(value), lower = Number(rule.min ?? 0), upper = rule.max == null || rule.max === "" ? Infinity : Number(rule.max);
    return !Number.isFinite(n) || n < 0 || n > 10000 || (kind !== "target" && !Number.isSafeInteger(n)) ||
      (kind !== "target" && lower > upper) || (kind === "min" && actual < n) || (kind === "max" && actual > n);
  };
  return <div className="dfw-review-bounds">{["min", "target", "max"].map(kind => <label className="dfw-field" key={kind}>
    <span>{C[{ min: "minimum", target: "target", max: "maximum" }[kind]]}</span>
    <input type="number" min="0" step={kind === "target" ? "any" : "1"} aria-label={C.bound(kind, name)}
      value={rule[kind] ?? ""} disabled={disabled} aria-invalid={invalid(kind)} aria-describedby={invalid(kind) ? `${fieldId}-${kind}` : undefined} onChange={e => onChange(kind, e.target.value)} />
    {invalid(kind) && <small className="dfw-error" id={`${fieldId}-${kind}`}>{C.invalidBound}</small>}
  </label>)}</div>;
}

function RosterComparison({ change }) {
  const originalIds = new Set(change.original?.lineup.map(row => row.player_id) || []), candidateIds = new Set(change.candidate?.lineup.map(row => row.player_id) || []);
  const removed = change.original?.lineup.filter(row => !candidateIds.has(row.player_id)) || [], added = change.candidate?.lineup.filter(row => !originalIds.has(row.player_id)) || [];
  return <><div className="dfw-review-rosters">{[[C.originalRoster, change.original], [C.candidateRoster, change.candidate]].map(([label, entry]) => <div key={label}>
    <h5>{label}</h5><p>{C.totalSalary}: {number(entry?.total_salary)} · {C.projectionSum}: {number(entry?.total_points)}</p>
    <div className="dfw-table-scroll"><table className="dfw-table"><thead><tr><th>{C.slot}</th><th>{C.players}</th><th className="num">{C.salaryColumn}</th><th className="num">{C.projectionColumn}</th></tr></thead>
      <tbody>{entry?.lineup.map(row => <tr key={row.slot}><td>{row.slot}</td><td>{row.player}<small>{row.player_id}</small></td><td className="num">{number(row.salary)}</td><td className="num">{number(row.proj)}</td></tr>)}</tbody></table></div>
  </div>)}</div><p>{C.removed}: {removed.map(row => `${row.player} (${row.player_id})`).join(" · ") || C.none}</p>
    <p>{C.added}: {added.map(row => `${row.player} (${row.player_id})`).join(" · ") || C.none}</p></>;
}

export default function DfsPortfolioReview({ b, audit, disabled = false }) {
  const rules = b.portfolioRules || { version: 1, players: {}, groups: [] };
  const [query, setQuery] = useState(""), [playerPage, setPlayerPage] = useState(0), [members, setMembers] = useState([]);
  const [supportIds, setSupportIds] = useState([]), [supportPage, setSupportPage] = useState(0);
  const [batchId, setBatchId] = useState(""), [mode, setMode] = useState("batch"), [originalIndex, setOriginalIndex] = useState(0), [candidateIndex, setCandidateIndex] = useState(0);
  const [preview, setPreview] = useState(null), [error, setError] = useState("");
  const previewButton = useRef(null), groupsDisclosure = useRef(null), replacementDisclosure = useRef(null);
  const catalog = useMemo(() => [...new Map(b.portfolio.flatMap(batch => batch.salaryCatalog.filter(p => p.salary != null).map(p => [p.player_id, p]))).values()], [b.portfolio]);
  const names = ids => ids.map(id => catalog.find(p => p.player_id === id)?.Player || id).join(" + ");
  const actualPlayers = new Map(audit.players.map(p => [p.id, p]));
  const players = catalog.filter(p => `${p.Player} ${p.Team} ${p.Position}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, z) => (actualPlayers.get(z.player_id)?.count || 0) - (actualPlayers.get(a.player_id)?.count || 0) || a.Player.localeCompare(z.Player));
  const playerPages = Math.ceil(players.length / 8), visiblePlayerPage = Math.min(playerPage, Math.max(0, playerPages - 1));
  const selectedBatch = b.portfolio.find(batch => batch.id === batchId) || b.portfolio[0];
  const selectedOriginal = Math.min(originalIndex, Math.max(0, (selectedBatch?.lineups.length || 1) - 1));
  const selectedCandidate = Math.min(candidateIndex, Math.max(0, (b.currentBuild?.lineups.length || 1) - 1));
  const supportingTotal = supportIds.length ? portfolioSupportingLineups(b.portfolio, supportIds, 0, 5).total : 0;
  const visibleSupportPage = Math.min(supportPage, Math.max(0, Math.ceil(supportingTotal / 5) - 1));
  const support = supportIds.length ? portfolioSupportingLineups(b.portfolio, supportIds, visibleSupportPage, 5) : { total: 0, rows: [] };
  const structure = audit.structure;
  const showSupport = ids => { setSupportIds([...ids]); setSupportPage(0); };
  const selectBounds = ids => { setMembers([...ids]); if (groupsDisclosure.current) groupsDisclosure.current.open = true; };
  const addGroup = () => {
    if (members.length < 2 || members.length > 9) { setError(C.groupSelect); return; }
    if (rules.groups.some(group => JSON.stringify([...group.player_ids].sort()) === JSON.stringify([...members].sort()))) { setError(C.repeatedGroup); return; }
    b.addPortfolioRuleGroup({ id: `collection:${crypto.randomUUID()}`, player_ids: [...members].sort() }); setMembers([]); setError("");
  };
  const beginPreview = () => {
    try {
      setPreview(previewPortfolioReplacement(b.portfolio, selectedBatch?.id, b.currentBuild, b.portfolioLimits, rules,
        mode === "lineup" ? { lineupIndex: selectedOriginal, candidateIndex: selectedCandidate } : null)); setError("");
    } catch (e) { setPreview(null); setError(e.message); }
  };
  const dismiss = () => { setPreview(null); setError(""); previewButton.current?.focus(); };
  const accept = () => { if (b.replacePortfolioBatch(preview)) dismiss(); };
  const changeSelection = setter => value => { setter(value); setPreview(null); setError(""); };
  const pairList = rows => <BoundedList rows={rows} render={pair => <li key={pair.id}><div>
    <strong>{pair.names.join(" + ")}</strong><span>{C.pairCount(pair.count, audit.total)} · {pair.batchCount} {C.batches.toLowerCase()}</span></div>
    <div className="dfw-plan-actions"><button type="button" onClick={() => showSupport(pair.player_ids)}>{C.support}</button>
      <button type="button" disabled={disabled} onClick={() => selectBounds(pair.player_ids)}>{C.setBounds}</button></div></li>} />;
  const measureRows = preview && [
    [C.total, preview.before.total, preview.after.total], [C.unique, preview.before.unique, preview.after.unique],
    [C.duplicates, preview.before.duplicates.length, preview.after.duplicates.length],
    [C.projectionSum, preview.before.structure.projectionSum, preview.after.structure.projectionSum],
    [C.totalSalary, preview.before.structure.salary?.sum, preview.after.structure.salary?.sum],
    [C.maxOverlap, preview.before.structure.overlap.max, preview.after.structure.overlap.max],
  ];
  return <div className="dfw-portfolio-review" data-testid="dfs-portfolio-review">
    <h3>{C.title}</h3>
    {!!b.portfolio.length && <>
      <dl className="dfw-review-summary">
        <div><dt>{C.unique}</dt><dd>{number(audit.unique)}</dd></div>
        <div><dt>{C.salary}</dt><dd>{structure.salary ? C.salaryRange(structure.salary.min, structure.salary.max) : "—"}</dd></div>
        {audit.total > 1 && <div><dt>{C.overlaps}</dt><dd>{structure.overlap.evaluated ? number(structure.overlap.max) : C.unknown}</dd></div>}
      </dl>
      <details className="dfw-review-sources"><summary>{C.sources}</summary><div className="dfw-guardrail-body">
        <p className="dfw-note">{C.help}</p>
        <p>{C.projections}: <strong>{number(structure.projectionSum)}</strong></p>
        <p className="dfw-note">{C.projectionHelp}</p>
        {structure.salary && <p>{C.salaryDetails}: {C.range(structure.salary.min, structure.salary.max, structure.salary.mean)}</p>}
        {!structure.overlap.evaluated && <p className="dfw-note">{C.overlapUnavailable}</p>}
        <BoundedList rows={b.portfolio} size={5} render={batch => {
          const usedIds = new Set(batch.lineups.flatMap(entry => entry.lineup.map(player => player.player_id)));
          const sources = [...new Set([...usedIds].map(id => batch.settings.projection_sources?.[id]).filter(source => typeof source === "string" && source.trim()))];
          return <li key={batch.id}><strong>{batch.label}</strong><span>{C.savedInputs}: {batch.settings.snapshot_at || C.unknown}</span>
            <span>{C.recordedSources}: {sources.length ? sources.join(" · ") : C.unknown}</span></li>;
        }} />
      </div></details>
      <details><summary>{C.playerBounds}</summary><div className="dfw-guardrail-body">
        <label className="dfw-field"><span>{C.playerSearch}</span><input type="text" value={query} onChange={e => { setQuery(e.target.value); setPlayerPage(0); }} /></label>
        <div className="dfw-table-scroll"><table className="dfw-table dfw-portfolio-audit dfw-card-table dfw-review-player-bounds"><thead><tr>
          <th>{C.players}</th><th className="num">{C.appearances}</th><th className="num">{C.qb}</th><th className="num">{C.batches}</th><th>{C.playerBounds}</th><th className="num">{C.miss}</th>
        </tr></thead><tbody>{players.slice(visiblePlayerPage * 8, visiblePlayerPage * 8 + 8).map(player => {
          const actual = actualPlayers.get(player.player_id), rule = rules.players[player.player_id] || {}, legacy = b.portfolioLimits[player.player_id];
          const target = audit.bounds.players.find(row => row.id === player.player_id)?.targetMiss;
          return <tr key={player.player_id}><td><button type="button" onClick={() => showSupport([player.player_id])}>{player.Player}</button>
            {legacy != null && legacy !== "" && <small>{C.legacyMaximum(legacy)}</small>}</td>
            <td className="num" data-label={C.appearances}>{actual?.count || 0} / {audit.total}</td><td className="num" data-label={C.qb}>{actual?.quarterbacks || 0}</td><td className="num" data-label={C.batches}>{actual?.batchCount || 0}</td>
            <td className="dfw-review-player-controls"><Bounds rule={{ ...rule, max: rule.max ?? legacy }} name={player.Player} actual={actual?.count || 0} disabled={disabled}
              onChange={(kind, value) => b.setPortfolioRule(player.player_id, kind, value)} /></td><td className="num" data-label={C.miss}>{number(target)}</td></tr>;
        })}</tbody></table></div><Pager page={visiblePlayerPage} pages={playerPages} onChange={setPlayerPage} />
      </div></details>
      <details ref={groupsDisclosure}><summary>{C.groupBounds}</summary><div className="dfw-guardrail-body">
        <p className="dfw-note">{C.groupHelp}</p>
        <label className="dfw-field"><span>{C.playerSearch}</span><input type="text" value={query} disabled={disabled} onChange={e => { setQuery(e.target.value); setPlayerPage(0); }} /></label>
        <div className="dfw-member-list" role="group" aria-label={C.combination}>{players.slice(visiblePlayerPage * 8, visiblePlayerPage * 8 + 8).map(player => <label className="dfw-check" key={player.player_id}>
          <input type="checkbox" disabled={disabled || (members.length >= 9 && !members.includes(player.player_id))} checked={members.includes(player.player_id)}
            onChange={() => setMembers(ids => ids.includes(player.player_id) ? ids.filter(id => id !== player.player_id) : [...ids, player.player_id])} />
          <span>{player.Player}<small>{player.Position} · {player.Team}</small></span></label>)}</div>
        <Pager page={visiblePlayerPage} pages={playerPages} onChange={setPlayerPage} />
        <p className="dfw-note">{C.selected(members.length)}{members.length ? ` · ${names(members)}` : ""}</p>
        <button type="button" disabled={disabled || rules.groups.length >= 50} onClick={addGroup}>{C.addGroup}</button>
        <BoundedList rows={rules.groups} size={5} render={group => {
          const bounds = audit.bounds.groups.find(row => row.id === group.id);
          return <li key={group.id}><div><strong>{names(group.player_ids)}</strong><span>{C.actual}: {bounds?.actual ?? 0} / {audit.total} · {C.miss}: {number(bounds?.targetMiss)}</span>
            <Bounds rule={group} name={names(group.player_ids)} actual={bounds?.actual ?? 0} disabled={disabled} onChange={(kind, value) => b.setPortfolioGroupRule(group.id, kind, value)} /></div>
            <div className="dfw-plan-actions"><button type="button" onClick={() => showSupport(group.player_ids)}>{C.support}</button>
              <button type="button" disabled={disabled} onClick={() => b.removePortfolioRuleGroup(group.id)}>{C.removeGroup}</button></div></li>;
        }} />
      </div></details>
      {(Object.keys(rules.players).length > 0 || rules.groups.length > 0 || Object.keys(b.portfolioLimits).length > 0) &&
        <button type="button" disabled={disabled} onClick={() => { b.clearPortfolioRules(); b.clearPortfolioLimits(); }}>{C.clear}</button>}
      <details><summary>{C.structure}</summary><div className="dfw-guardrail-body">
        <p className="dfw-note">{C.structureHelp}</p>
        <h4>{C.rbPairs}</h4>{pairList(structure.pairs.filter(pair => pair.rb))}
        <details><summary>{C.pairs}</summary>{pairList(structure.pairs)}</details>
        <p>{C.flex}: {Object.entries(structure.flex).map(([pos, count]) => `${pos} ${count} / ${audit.total}`).join(" · ")}</p>
        <h4>{C.stacks}</h4><BoundedList rows={structure.stackSizes} render={row => <li key={row.id}><span>{C.stack(row)}</span><strong>{row.count} / {audit.total}</strong></li>} />
        <h4>{C.games}</h4><BoundedList rows={structure.qbGames} render={row => <li key={row.id}><span>{row.player} · {row.team || C.unknown} / {row.opponent || C.unknown}</span><strong>{row.count} / {audit.total}</strong></li>} />
        <h4>{C.defenses}</h4><BoundedList rows={structure.defenses} render={row => <li key={row.id}><span>{row.player}</span><strong>{row.count} / {audit.total}</strong></li>} />
        <h4>{C.teams}</h4><BoundedList rows={structure.teams} render={row => <li key={row.id}><span>{row.team}</span><strong>{row.count} / {audit.total}</strong></li>} />
        <h4>{C.injuries}</h4>{structure.injuryAssumptions.length ? <BoundedList rows={structure.injuryAssumptions} render={row => <li key={`${row.id}:${row.status}`}><span>{row.player} · {row.status}</span><strong>{row.count} / {audit.total}</strong></li>} /> : <p className="dfw-note">{C.noInjuries}</p>}
      </div></details>
      {!!supportIds.length && <section className="dfw-global-verdict" data-testid="dfs-portfolio-support"><h4>{C.supportTitle}: {names(supportIds)}</h4>
        {!support.total && <p className="dfw-note">{C.emptySupport}</p>}
        <ul className="dfw-review-list">{support.rows.map(row => <li key={`${row.batchId}:${row.lineupIndex}`}><div>
          <strong>{C.lineup(row.label, row.lineupIndex)}</strong><p className="dfw-note">{row.entry.lineup.map(player => `${player.slot} ${player.player}`).join(" · ")}</p></div>
          <button type="button" disabled={disabled} onClick={() => { setBatchId(row.batchId); setOriginalIndex(row.lineupIndex); setMode("lineup"); setPreview(null); if (replacementDisclosure.current) replacementDisclosure.current.open = true; previewButton.current?.scrollIntoView({ block: "center" }); previewButton.current?.focus(); }}>{C.reviewLineup}</button></li>)}</ul>
        <Pager page={visibleSupportPage} pages={Math.ceil(support.total / 5)} onChange={setSupportPage} />
      </section>}
      {b.canUndoPortfolioReplacement && <button type="button" disabled={disabled} onClick={b.undoPortfolioReplacement}>{C.undo}</button>}
      <details ref={replacementDisclosure} className="dfw-replacement-details"><summary>{C.replacement}</summary>
      <section className="dfw-review-controls"><p className="dfw-note">{C.replacementHelp}</p>
        <div className="dfw-settings-grid"><HubFilterMenu label={C.batch} value={selectedBatch?.id || ""} options={b.portfolio.map(batch => ({ id: batch.id, label: batch.label }))}
          disabled={disabled} onChange={changeSelection(setBatchId)} />
          <HubFilterMenu label={C.mode} value={mode} options={C.modes} disabled={disabled} onChange={changeSelection(setMode)} />
          {mode === "lineup" && <><HubFilterMenu label={C.originalLineup} value={selectedOriginal} options={selectedBatch?.lineups.map((_, index) => ({ id: index, label: C.lineup(selectedBatch.label, index) })) || []}
            disabled={disabled} onChange={changeSelection(value => setOriginalIndex(Number(value)))} />
            <HubFilterMenu label={C.candidateLineup} value={selectedCandidate} options={b.currentBuild?.lineups.map((_, index) => ({ id: index, label: C.lineup(C.after, index) })) || []}
              disabled={disabled || !b.currentBuild} onChange={changeSelection(value => setCandidateIndex(Number(value)))} /></>}
        </div>
        {!b.currentBuild && <p className="dfw-note">{C.noCandidate}</p>}
        <div className="dfw-plan-actions"><button ref={previewButton} type="button" disabled={disabled || !b.currentBuild || !selectedBatch} onClick={beginPreview}>{mode === "lineup" ? C.previewLineup : C.preview}</button></div>
      </section></details>
      {preview && <section className="dfw-global-verdict" data-testid="dfs-portfolio-replacement-preview" aria-label={C.previewTitle}>
        <h4>{C.previewTitle}</h4><p>{C.identities(preview.delta.unchangedLineups, preview.delta.removedLineups, preview.delta.addedLineups)}</p>
        <p>{C.approvedLocks}: {preview.approvedLocks.length ? names(preview.approvedLocks) : C.noLocks}</p>
        <p>{C.approvedCores}: {preview.approvedCores.length ? preview.approvedCores.map(group => `${names(group.player_ids)} ≥ ${group.min}`).join(" · ") : C.noCores}</p>
        {preview.selection ? preview.rosterChanges.map((change, n) => <RosterComparison key={n} change={change} />) :
          !!preview.rosterChanges.length && <details><summary>{C.changedRosters}</summary>{preview.rosterChanges.map((change, n) => <RosterComparison key={n} change={change} />)}</details>}
        <div className="dfw-table-scroll"><table className="dfw-table dfw-review-compare"><thead><tr><th>{C.metric}</th><th className="num">{C.before}</th><th className="num">{C.after}</th></tr></thead>
          <tbody>{measureRows.map(([label, before, after]) => <tr key={label}><th scope="row">{label}</th><td className="num">{number(before)}</td><td className="num">{number(after)}</td></tr>)}</tbody></table></div>
        <p className="dfw-note">{C.projectionHelp} {C.utility}</p><p>{C.unchangedPlayers(preview.unchangedPlayerCounts)}</p>
        <h4>{C.changedPlayers}</h4><BoundedList rows={preview.playerDeltas} render={row => <li key={row.id}><span>{row.player || row.id}</span><strong>{row.before} → {row.after} ({row.delta > 0 ? "+" : ""}{row.delta})</strong></li>} />
        <h4>{C.pairs}</h4><BoundedList rows={preview.pairDeltas} render={row => <li key={row.id}><span>{row.names.join(" + ")}</span><strong>{row.before} → {row.after}</strong></li>} />
        {!!preview.warningsRemoved.length && <><h4>{C.warningsRemoved}</h4><ul>{preview.warningsRemoved.map((warning, n) => <li key={n}>{warning}</li>)}</ul></>}
        {preview.blockers.map((warning, n) => <p className="dfw-error" key={n}>{warning}</p>)}
        <p className={preview.canApply ? "dfw-note" : "dfw-error"}>{preview.canApply ? C.ready : C.blocked}</p><p className="dfw-note">{C.replacementEffect}</p>
        <div className="dfw-plan-actions"><button type="button" disabled={disabled || !preview.canApply} onClick={accept}>{C.apply}</button>
          <button type="button" onClick={dismiss}>{C.cancel}</button></div>
      </section>}
    </>}
    {error && <p className="dfw-error" role="alert">{error}</p>}
  </div>;
}
