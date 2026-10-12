import { DFS_SHOWDOWN_COPY as C, normalizeDfsTeam } from "./dfsToolPresentation.js";

const finite = value => value != null && value !== "" && Number.isFinite(Number(value));
const sum = (rows, key) => rows.every(row => finite(row[key])) ? rows.reduce((n, row) => n + Number(row[key]), 0) : null;
export const newShowdownRules = () => ({ receiver_captain_qb: "require", approved_qb_ids: {} });
export function approvePairingQb(rules, team, id) {
  const normalized = normalizeDfsTeam(team);
  const mapping = Object.fromEntries(Object.entries(rules?.approved_qb_ids || {}).filter(([key]) => normalizeDfsTeam(key) !== normalized));
  if (id) mapping[normalized] = [id];
  return { receiver_captain_qb: rules?.receiver_captain_qb || "warn", approved_qb_ids: mapping };
}
export function approvedPairingIds(rules, team) {
  return Object.entries(rules?.approved_qb_ids || {}).filter(([key]) => normalizeDfsTeam(key) === normalizeDfsTeam(team)).flatMap(([, ids]) => ids);
}
/** Exact salary identities define the selected slate; team membership is insufficient. */
export function showdownSlatePool(pool = [], salaries) {
  if (!Array.isArray(pool)) return [];
  const salaried = row => finite(row.salary) && Number(row.salary) > 0;
  if (!Array.isArray(salaries) || !salaries.length) return pool.filter(salaried);
  const canonicalIds = new Set(salaries.filter(salaried).map(row => row.player_id).filter(Boolean));
  const providerIds = new Set(salaries.filter(salaried).flatMap(row => [row.dfs_id, row.cpt_dfs_id]).filter(value => value != null && value !== "").map(String));
  return pool.filter(row => salaried(row) && (canonicalIds.has(row.player_id) ||
    [row.dfs_id, row.cpt_dfs_id].some(id => id != null && providerIds.has(String(id)))));
}
export function showdownComparisonPool(build) {
  // Prefer the immutable solver inputs over a later live pool or a league-wide catalog.
  const frozen = build?.settings?.build_snapshot?.content?.input_pool;
  const rows = Array.isArray(frozen) ? frozen : build?.salaryCatalog || [];
  return showdownSlatePool(rows, build?.settings?.slate_salaries);
}
export function showdownPlayerGaps(player, salaryCap = 50000) {
  const d = player?.diagnostics || {};
  const role = d.current_role_estimate;
  const provided = value => typeof value === "number" ? Number.isFinite(value) : typeof value === "string" && Boolean(value.trim()) && !["unknown", "unavailable", "n/a", "null", "none"].includes(value.trim().toLowerCase());
  const roleKnown = role != null && (typeof role === "object" ? Object.values(role).some(provided) : provided(role));
  const zero = d.predicted_zero_probability;
  const zeroKnown = (typeof zero === "number" || typeof zero === "string" && Boolean(zero.trim())) && finite(zero) && Number(zero) >= 0 && Number(zero) <= 1;
  // DraftKings CPT salary is weighted. FanDuel MVP salary remains at base cost.
  const multiplier = player?.slot === "CPT" ? Number(player.multiplier) || 1.5 : 1;
  const baseSalary = finite(player?.salary) ? Number(player.salary) / multiplier : null;
  return { statusUnknown: normalizedBuildStatus(player) === "unknown", roleUnknown: !roleKnown, zeroUnknown: !zeroKnown,
    zeroProbability: zeroKnown ? Number(zero) : null, baseSalary,
    lowSalary: baseSalary != null && baseSalary > 0 && finite(salaryCap) && baseSalary <= Number(salaryCap) * .1 };
}
export function showdownScoreMetadata(value) {
  const keys = ["objective_key", "objective_label", "objective_score", "objective_units", "objective_semantics", "projection_sum", "projection_statistic", "projection_label", "score_system_id", "captain_multiplier_applied", "forecast_snapshot_id", "injury_snapshot_id", "availability_conditioning", "solver_status", "precision", "display_precision", "numeric_tolerance"];
  return Object.fromEntries(keys.filter(key => Object.hasOwn(value || {}, key)).map(key => [key, value[key]]));
}
export function showdownRulesFromSettings(settings) {
  // Missing historical keys remain absent; a new default must never rewrite history.
  return settings?.showdown_rules == null ? null : structuredClone(settings.showdown_rules);
}
export function showdownScore(entry, objective = "median") {
  const rows = entry?.lineup || [], supplied = entry?.score_metadata || showdownScoreMetadata(entry);
  const key = supplied.objective_key || objective;
  // Result rows already contain slot-weighted values. Never multiply Captain again.
  const projection = rows.every(row => finite(row.projection_coefficient)) ? sum(rows, "projection_coefficient") : sum(rows, "proj");
  const recomputed = rows.every(row => finite(row.objective_coefficient)) ? sum(rows, "objective_coefficient") : key === "value" ? (rows.every(row => finite(row.proj) && finite(row.salary) && Number(row.salary) > 0)
    ? rows.reduce((n, row) => n + Number(row.proj) / Number(row.salary) * 1000, 0) : null)
    : sum(rows, ({ median: "proj", floor: "floor", ceiling: "ceiling" })[key] || "proj");
  const precision = Number.isInteger(supplied.precision) ? supplied.precision : Number.isInteger(supplied.display_precision) ? supplied.display_precision : 2;
  // Per-slot rounding can account for 0.005 per slot, in addition to total rounding.
  const exactCoefficients = rows.length > 0 && rows.every(row => finite(row.objective_coefficient) && finite(row.projection_coefficient));
  const tolerance = (exactCoefficients ? 1 : rows.length + 1) * 0.5 * 10 ** -precision + 1e-8;
  const agrees = !finite(supplied.objective_score) || recomputed == null || Math.abs(Number(supplied.objective_score) - recomputed) <= tolerance;
  const projectionAgrees = !finite(supplied.projection_sum) || projection == null || Math.abs(Number(supplied.projection_sum) - projection) <= tolerance;
  return { ...supplied, objective_key: key, objective_label: supplied.objective_label || C.objectives[key] || C.objectives.median,
    objective_score: agrees ? (finite(supplied.objective_score) ? Number(supplied.objective_score) : recomputed) : null,
    objective_units: key === "value" ? C.valueUnits : C.pointUnits,
    projection_sum: projectionAgrees ? (finite(supplied.projection_sum) ? Number(supplied.projection_sum) : projection) : null,
    projection_label: supplied.projection_statistic === "unknown" || !supplied.projection_statistic ? C.projectionUnknown : supplied.projection_label || C.projectionUnknown,
    projection_statistic: supplied.projection_statistic || "unknown", consistent: agrees && projectionAgrees,
    objective_semantics: C.scoreHelp[key] || C.scoreHelp.median };
}
export function normalizedBuildStatus(row) {
  const raw = row?.diagnostics?.build_injury_status ?? row?.injury_status ?? row?.["Injury Status"];
  const text = String(raw || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!text || ["unknown", "unavailable", "n/a"].includes(text)) return "unknown";
  if (["q", "questionable"].includes(text)) return "questionable";
  if (["d", "doubtful"].includes(text)) return "doubtful";
  if (["o", "out"].includes(text)) return "out";
  if (["ir", "injured reserve", "reserve injured"].includes(text) || text.startsWith("ir ") || text.endsWith(" injured reserve")) return "ir";
  if (text === "physically unable to perform" || text.startsWith("pup") || text.startsWith("reserve pup")) return "pup";
  if (text.includes("limited")) return "limited";
  if (["active", "healthy", "available"].includes(text)) return "active";
  if (["inactive", "suspended", "probable"].includes(text)) return text;
  if (["lp", "limited practice"].includes(text)) return "limited";
  if (["dnp", "did not practice"].includes(text)) return "did not practice";
  for (const prefix of ["out", "questionable", "doubtful", "inactive", "suspended"]) if (text.startsWith(`${prefix} `)) return prefix;
  return "unknown";
}
export function assertShowdownAvailable(lineups, latestPool) {
  if (!Array.isArray(latestPool)) throw new Error(C.availabilityFailed);
  const byId = new Map(latestPool.map(row => [row.player_id, row]));
  const unavailable = [...new Set(lineups.flatMap(entry => entry.lineup || []).filter(row => {
    const current = byId.get(row.player_id);
    return current && ["out", "ir", "inactive", "pup", "suspended"].includes(normalizedBuildStatus(current));
  }).map(row => row.player))];
  if (unavailable.length) throw new Error(C.unavailableExport(unavailable.join(", ")));
}
export function showdownAudit(entry) {
  const audit = entry?.construction_audit;
  return Array.isArray(audit) ? audit : Array.isArray(audit?.findings) ? audit.findings : entry?.showdown_review?.lineups?.[0]?.findings || [];
}
export function groupedShowdownFindings(lineups = []) {
  const groups = new Map(), affected = new Set();
  lineups.forEach((entry, index) => showdownAudit(entry).forEach(finding => {
    if (!finding?.code || !["warning", "error", "blocker", "attention"].includes(finding.severity)) return;
    affected.add(index);
    const group = groups.get(finding.code) || { ...finding, indexes: new Set(), player_ids: new Set() };
    group.indexes.add(index); (finding.player_ids || []).forEach(id => group.player_ids.add(id)); groups.set(finding.code, group);
  }));
  return { affected: [...affected], groups: [...groups.values()].map(group => ({ ...group, indexes: [...group.indexes], player_ids: [...group.player_ids] })) };
}
export function showdownExposures(lineups = []) {
  const players = new Map(), denominator = lineups.length;
  lineups.forEach(entry => (entry.lineup || []).forEach(row => {
    const player = players.get(row.player_id) || { ...row, total_count: 0, captain_count: 0, flex_count: 0, denominator };
    player.total_count++; if (["CPT", "MVP"].includes(row.slot)) player.captain_count++; else player.flex_count++;
    players.set(row.player_id, player);
  }));
  return [...players.values()].map(row => ({ ...row, total_share: row.total_count / denominator, captain_share: row.captain_count / denominator, flex_share: row.flex_count / denominator }))
    .sort((a, b) => b.total_count - a.total_count || String(a.player).localeCompare(String(b.player)));
}
export function showdownWarningPairs(lineups = []) {
  const pairs = new Map();
  lineups.forEach(entry => showdownAudit(entry).filter(finding => finding.player_ids?.length === 2 && finding.severity !== "info").forEach(finding => {
    const ids = [...finding.player_ids].sort(), key = JSON.stringify(ids);
    if (!pairs.has(key)) pairs.set(key, { player_ids: ids, code: finding.code });
  }));
  return [...pairs.values()].map(pair => ({ ...pair, count: lineups.filter(entry => pair.player_ids.every(id => entry.lineup.some(player => player.player_id === id))).length, denominator: lineups.length }));
}
export function availablePairingQbs(pool) {
  const teams = new Map();
  pool.filter(row => String(row.Position || row.position).toUpperCase() === "QB").forEach(row => {
    const team = normalizeDfsTeam(row.Team || row.team);
    const list = teams.get(team) || []; list.push(row); teams.set(team, list);
  });
  return [...teams].sort(([a], [b]) => a.localeCompare(b));
}
export function missingPairingTeams(pool, rules) {
  if (rules?.receiver_captain_qb !== "require") return [];
  const receiverTeams = new Set(pool.filter(row => ["WR", "TE"].includes(String(row.Position || row.position).toUpperCase())).map(row => normalizeDfsTeam(row.Team || row.team)).filter(Boolean));
  return [...receiverTeams].filter(team => !pool.some(row => normalizeDfsTeam(row.Team || row.team) === team && String(row.Position || row.position).toUpperCase() === "QB" &&
    !["out", "ir", "pup", "inactive", "suspended"].includes(normalizedBuildStatus(row)) &&
    (approvedPairingIds(rules, team).includes(row.player_id) || row.verified_starting_qb === true || (row.qb_role_verified === true && row.qb_role === "starter")))).sort();
}
export function makeShowdownReview(build, comparison = null) {
  if (build?.context?.site !== "draftkings_showdown" || !build.lineups?.length || !build.settings?.build_snapshot) throw new Error(C.reviewInvalid);
  return { schema_version: "dfs_showdown_personal_review_v1", saved_at: new Date().toISOString(), historical_only: true,
    build: structuredClone(build), comparison: structuredClone(comparison) };
}
export function readShowdownReview(text) {
  if (typeof text !== "string" || new TextEncoder().encode(text).length > 8 * 1024 * 1024) throw new Error(C.reviewInvalid);
  const value = JSON.parse(text);
  const build = value?.build;
  if (value?.schema_version !== "dfs_showdown_personal_review_v1" || value.historical_only !== true || build?.context?.site !== "draftkings_showdown" ||
      !Array.isArray(build.lineups) || !build.lineups.length || build.lineups.length > 150 || !build.settings?.build_snapshot?.id ||
      !Array.isArray(build.salaryCatalog) || build.salaryCatalog.length > 600 || build.lineups.some(entry => !Array.isArray(entry.lineup) || entry.lineup.length !== 6 ||
        new Set(entry.lineup.map(row => row.player_id)).size !== 6 || entry.lineup.some(row => typeof row.player_id !== "string" || !row.player_id || !finite(row.proj)))) throw new Error(C.reviewInvalid);
  // This opens an inspectable historical record, never imports active controls or entries.
  return structuredClone(value);
}
