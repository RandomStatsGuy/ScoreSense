import { freezeSnapshot } from "./dfsPortfolio.js";
import { stableBuildKey } from "./dfsEntryExportSeal.js";
import { normalizeClassicStackRules } from "./dfsClassicStackRules.js";
import { normalizeDfsTeam, DFS_EVIDENCE_COPY as C } from "./dfsToolPresentation.js";

const finite = value => (typeof value === "number" || typeof value === "string" && value.trim() !== "") && Number.isFinite(Number(value));
const exactId = id => typeof id === "string" && id.length > 0 && id === id.trim();
export function primaryQbScope(b) {
  if (b.stackScope?.teams?.length || b.stackScope?.qbIds?.length) return b.stackScope;
  const selected = new Set(Object.entries(b.stackWeights || {}).filter(([, value]) => Number(value) > 0).map(([id]) => id));
  const teams = new Set((b.vegasGames || []).filter(g => selected.has(g.game_id)).flatMap(g => [normalizeDfsTeam(g.home), normalizeDfsTeam(g.away)]));
  const qbIds = (b.pool || []).filter(p => p.Position === "QB" && (selected.has(p.game_id) || teams.has(normalizeDfsTeam(p.Team)))).map(p => p.player_id);
  if (selected.size && !qbIds.length) throw new Error(C.focusMissing);
  return { teams: [], qbIds };
}
export function evidenceContext(b) {
  const slate = b.context?.slateId || b.buildPlanValidation?.salarySnapshot?.id;
  if (b.context?.site !== "draftkings" || !slate || !Number.isInteger(Number(b.context.season)) ||
      !Number.isInteger(Number(b.context.week)) || !b.context.season || !b.context.week) return null;
  return { site: "draftkings", sport: "NFL", format: "classic", season: Number(b.context.season), week: Number(b.context.week), slate_id: String(slate) };
}

export function comparisonInputs(b) {
  const context = evidenceContext(b);
  if (!context) throw new Error(C.contextRequired);
  const ids = new Set();
  const pool = [];
  for (const p of b.pool || []) {
    if (!exactId(p.player_id) || ids.has(p.player_id)) throw new Error(C.exactIds);
    ids.add(p.player_id);
    if (!["Projected Points", "Low (P10)", "High (P90)", "salary"].every(k => finite(p[k])) ||
        !Number.isSafeInteger(Number(p.salary)) || Number(p.salary) <= 0) continue;
    pool.push({ player_id: p.player_id, name: p.Player || p.Name || p.player_id,
      team: normalizeDfsTeam(p.Team), position: p.Position, opponent: normalizeDfsTeam(p.Opponent),
      proj: Number(p["Projected Points"]), floor: Number(p["Low (P10)"]), ceiling: Number(p["High (P90)"]),
      salary: Number(p.salary), dfs_id: p.dfs_id == null ? "" : String(p.dfs_id),
      injury_status: p["Injury Status"] || "", on_bye: Boolean(p.on_bye), value: finite(p.value) ? Number(p.value) : null });
  }
  if (pool.length < 9 || pool.length > 750) throw new Error(C.poolRequired);
  const included = new Set(pool.map(p => p.player_id));
  if ((b.locked || []).some(id => !included.has(id))) throw new Error(C.lockMissing);
  const s = b.settings || {};
  const scope = primaryQbScope(b);
  const salaryCap = s.maxSalary == null ? 50000 : Number(s.maxSalary);
  const minSalary = s.minSalary == null ? 0 : Number(s.minSalary);
  const maxPerTeam = s.maxTeam == null ? 0 : Number(s.maxTeam);
  if (![salaryCap, minSalary, maxPerTeam].every(Number.isSafeInteger) || salaryCap <= 0 || salaryCap > 50000 || minSalary < 0 || minSalary > salaryCap || maxPerTeam < 0 || maxPerTeam > 9)
    throw new Error(C.invalidControls);
  // Match optimizer precedence: an explicit zero count overrides the older
  // boolean flag. Do not silently invent an extra hard lock for comparisons.
  const stackCount = s.qbStack == null ? (s.requireQbStack ? 1 : 0) : Number(s.qbStack);
  if (!Number.isSafeInteger(stackCount) || stackCount < 0 || stackCount > 7) throw new Error(C.invalidControls);
  const rules = s.portfolioMode === "global" ? normalizeClassicStackRules(b.classicStackRules, b.pool) : {
    version: 1, attachments: { mode: stackCount > 0 ? "minimum" : "optional",
      count: stackCount, receiving_rb_ids: [] },
    bring_back: { mode: s.bringBack ? "minimum" : "optional", count: s.bringBack ? 1 : 0 } };
  return { context, pool, objective: s.objective || "median", locked_player_ids: [...(b.locked || [])],
    excluded_player_ids: [...(b.excluded || [])], salary_cap: salaryCap,
    min_salary: minSalary, max_per_team: maxPerTeam,
    block_qb_opposing_dst: s.blockQbDst !== false, classic_stack_rules: rules,
    receiving_rb_ids: rules?.attachments.receiving_rb_ids || [],
    stack_teams: [...(scope.teams || [])], stack_qb_ids: [...(scope.qbIds || [])] };
}

export function compatibleEvidence(evidence, context) {
  return Boolean(context && evidence?.context && Object.keys(context).every(k => evidence.context[k] === context[k]));
}

export async function selectDecisionSnapshot(inputs, evidence, now = new Date().toISOString(), sourcePool = []) {
  if (evidence && !compatibleEvidence(evidence, inputs.context)) throw new Error(C.contextMismatch);
  const sourceById = new Map(sourcePool.map(p => [p.player_id, p]));
  const sources = inputs.pool.map(p => ({ player_id: p.player_id,
    source: sourceById.get(p.player_id)?.projection_source || "selected_pool_input", published_at: null, known_at: null }));
  const content = { ...inputs, evidence_id: evidence?.content_id || null, frozen_at: now };
  const key = await stableBuildKey({ ...content, projection_receipts: sources });
  return freezeSnapshot({ ...content, input_snapshot_id: key.replace(/^build:/, "decision:"),
    evidence: evidence || null, projection_receipts: sources,
    projection_provenance: "Selected user-visible inputs; publication and archived known-at times are not attested." });
}

export function comparisonRequest(snapshot) {
  const { evidence, projection_receipts, projection_provenance, ...request } = snapshot;
  return request;
}

export function validateComparisonResponse(snapshot, report) {
  if (report?.input_snapshot_id !== snapshot.input_snapshot_id || report?.evidence_id !== snapshot.evidence_id ||
      report?.objective !== snapshot.objective || !Array.isArray(report?.candidates) || report.candidates.length > 320)
    throw new Error(C.responseMismatch);
  return report;
}

/** Portable reviews retain evidence references, not licensed raw observations. */
export function portableComparisonReview(snapshot, report, collectionComparisons = []) {
  const { evidence, ...inputs } = snapshot;
  return { version: 1, snapshot: { ...inputs, evidence_reference: evidence ? {
    content_id: evidence.content_id, context: evidence.context, decision_at: evidence.decision_at,
    evidence_scope: evidence.evidence_scope, sources: evidence.sources || [],
    archive_scope: "Source receipts only; raw and derived source observations are not redistributed." } : null },
    report, collection_comparisons: collectionComparisons };
}

/** Exact eligible pair membership; never fall back to every weekly game. */
export function eligibleEvidenceGames(evidence, pool) {
  const gameIds = new Set(pool.map(p => p.game_id).filter(Boolean));
  const pairs = new Set(pool.map(p => [normalizeDfsTeam(p.Team), normalizeDfsTeam(p.Opponent)].sort().join(":")));
  return (evidence?.games || []).filter(g => gameIds.has(g.game_id) || pairs.has([g.home, g.away].sort().join(":")));
}

export function commonSnapshotScores(snapshot, batches = []) {
  if (!snapshot) return [];
  const pool = new Map(snapshot.pool.map(p => [p.player_id, p]));
  return batches.flatMap(batch => (batch.lineups || []).map((entry, index) => {
    const ids = (entry.lineup || []).map(p => p.player_id);
    const missing = ids.filter(id => !pool.has(id));
    const complete = ids.length === 9 && new Set(ids).size === 9 && !missing.length;
    const score = p => snapshot.objective === "floor" ? p.floor : snapshot.objective === "ceiling" ? p.ceiling :
      snapshot.objective === "value" ? (p.value ?? p.proj / p.salary * 1000) : p.proj;
    return { batch_id: batch.id, label: batch.label, lineup_index: index, status: complete ? "available" : "unavailable",
      missing_ids: missing, objective_score: complete ? ids.reduce((sum, id) => sum + score(pool.get(id)), 0) : null,
      salary: complete ? ids.reduce((sum, id) => sum + pool.get(id).salary, 0) : null };
  }));
}
