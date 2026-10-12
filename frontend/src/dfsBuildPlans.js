import { normalizeDfsTeam, OBJECTIVES } from "./dfsToolPresentation.js";
import { exposureBoundCount } from "./dfsExposureBounds.js";
import { normalizeClassicStackRules } from "./dfsClassicStackRules.js";

export const BUILD_PLAN_SCHEMA = "scoresense_dfs_build_plan";
export const BUILD_PLAN_VERSION = 1;
export const BUILD_PLAN_MAX_BYTES = 512 * 1024;
export const BUILD_PLAN_INPUT_KEYS = ["portfolio_mode", "lineup_count", "objective", "salary_cap", "min_salary", "max_per_team",
  "max_overlap", "max_exposure", "randomness", "locked_player_ids", "excluded_player_ids", "require_qb_stack", "qb_stack_count",
  "stack_bring_back", "stack_teams", "stack_qb_ids", "stack_game_weights", "classic_stack_rules", "player_exposure_limits",
  "group_exposure_limits", "block_qb_opposing_dst"];
const DEFAULTS = { portfolio_mode: "legacy", lineup_count: 20, objective: "median", salary_cap: 50000, min_salary: 0,
  max_per_team: 0, max_overlap: 7, max_exposure: 1, randomness: 0, locked_player_ids: [], excluded_player_ids: [],
  require_qb_stack: false, qb_stack_count: 0, stack_bring_back: false, stack_teams: [], stack_qb_ids: [], stack_game_weights: [],
  classic_stack_rules: null, player_exposure_limits: {}, group_exposure_limits: [], block_qb_opposing_dst: true };
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
function freezeSnapshot(value) {
  const copy = structuredClone(value);
  const freeze = item => { if (item && typeof item === "object") { Object.values(item).forEach(freeze); Object.freeze(item); } return item; };
  return freeze(copy);
}
const fail = reason => { throw new Error(`Build plan: ${reason}`); };
const canonical = value => JSON.stringify(value, (_key, item) => object(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const shape = (value, allowed, required = allowed) => {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(value, key))) fail("invalid or incomplete fields.");
};
const text = (value, label, max = 100, empty = false) => {
  if (typeof value !== "string" || value.length > max || (!empty && !value.trim()) || value !== value.trim()) fail(`${label} must be exact text.`);
};
const id = value => { text(value, "ID"); if (!/^[A-Za-z0-9:_-]+$/.test(value)) fail("use an immutable ID, independent of the display label."); };
const integer = (value, low, high, label) => { if (!Number.isSafeInteger(value) || value < low || value > high) fail(`invalid ${label}.`); };
function boundedJson(value) {
  let nodes = 0;
  const walk = (item, depth) => {
    if (++nodes > 30000 || depth > 12) fail("file is too complex.");
    if (item === null || typeof item === "boolean") return;
    if (typeof item === "string") { if (item.length > 1000) fail("text is too long."); return; }
    if (typeof item === "number") { if (!Number.isFinite(item)) fail("numbers must be finite."); return; }
    if (Array.isArray(item)) { if (item.length > 5000) fail("list is too large."); item.forEach(child => walk(child, depth + 1)); return; }
    if (!object(item)) fail("unsupported JSON value.");
    for (const [key, child] of Object.entries(item)) {
      if (["__proto__", "prototype", "constructor"].includes(key) || /token|password|credential|authorization|cookie|secret/i.test(key)) fail("unsupported private or executable field.");
      walk(child, depth + 1);
    }
  };
  walk(value, 0);
  if (new TextEncoder().encode(JSON.stringify(value)).length > BUILD_PLAN_MAX_BYTES) fail("file exceeds 512 KiB.");
}
function slateIdentity({ context, salarySnapshot } = {}) {
  if (!context || context.site !== "draftkings") fail("plans require a loaded DraftKings Classic slate.");
  return { site: context.site, season: context.season, week: context.week,
    slate_id: context.slate_id ?? context.slateId ?? "", salary_snapshot_id: context.salary_snapshot_id ?? salarySnapshot?.id ?? null };
}
function catalogMap(catalog) {
  if (!Array.isArray(catalog) || !catalog.length || catalog.length > 5000) fail("load the slate player catalog first.");
  const players = new Map(), uploadIds = new Set(), canonicalIds = new Set();
  for (const player of catalog) {
    text(player.player_id, "Canonical player ID");
    if (canonicalIds.has(player.player_id)) fail("catalog repeats a canonical player ID.");
    canonicalIds.add(player.player_id);
    if (player.salary == null) continue;
    text(player.dfs_id, "Provider player ID");
    if (!/^\d+$/.test(player.dfs_id) || /^0+$/.test(player.dfs_id) || uploadIds.has(player.dfs_id)) fail("catalog has invalid or repeated provider IDs.");
    const member = identity(player);
    if (!member.team || member.team === "BYE" || !["QB", "RB", "WR", "TE", "DST"].includes(member.position) || !Number.isSafeInteger(player.salary) || player.salary < 1)
      fail("catalog has an unknown team, unsupported position or invalid salary.");
    uploadIds.add(player.dfs_id); players.set(player.player_id, player);
  }
  return players;
}
const identity = player => ({ player_id: player.player_id, dfs_id: player.dfs_id,
  team: normalizeDfsTeam(player.Team ?? player.team), position: String(player.Position ?? player.position).toUpperCase() });
function ids(values, players, label) {
  if (!Array.isArray(values) || values.length > 5000 || values.some(value => typeof value !== "string" || !players.has(value)) || new Set(values).size !== values.length)
    fail(`${label} references a missing, repeated or ineligible canonical player ID.`);
  return [...values].sort();
}
function normalizeInputs(value) {
  const result = Object.fromEntries(BUILD_PLAN_INPUT_KEYS.map(key => [key, structuredClone(value[key] ?? DEFAULTS[key])]));
  for (const key of ["locked_player_ids", "excluded_player_ids", "stack_qb_ids"]) if (Array.isArray(result[key])) result[key].sort();
  if (Array.isArray(result.stack_teams)) result.stack_teams = result.stack_teams.map(normalizeDfsTeam).sort();
  if (Array.isArray(result.stack_game_weights)) result.stack_game_weights = result.stack_game_weights.map(game => ({ ...game, teams: Array.isArray(game.teams) ? game.teams.map(normalizeDfsTeam).sort() : game.teams })).sort((a, b) => String(a.game_id).localeCompare(String(b.game_id)));
  if (Array.isArray(result.group_exposure_limits)) result.group_exposure_limits = result.group_exposure_limits.map(group => ({ ...group, player_ids: Array.isArray(group.player_ids) ? [...group.player_ids].sort() : group.player_ids })).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  result.classic_stack_rules = normalizeClassicStackRules(result.classic_stack_rules);
  return result;
}
function comparisonInputs(value) {
  const result = normalizeInputs(value), count = result.lineup_count;
  const bounds = rule => ({ min: exposureBoundCount(rule.min ?? 0, count, "min"),
    max: exposureBoundCount(rule.max ?? 1, count, "max"),
    target: rule.target == null ? null : exposureBoundCount(rule.target, count, "target") });
  result.player_exposure_limits = Object.fromEntries(Object.entries(result.player_exposure_limits).map(([player, rule]) => [player, bounds(rule)]));
  result.group_exposure_limits = result.group_exposure_limits.map(group => ({ id: group.id, player_ids: group.player_ids, ...bounds(group) }));
  return result;
}
function validateInputs(inputs, options) {
  const players = catalogMap(options.catalog), count = inputs.lineup_count;
  if (!["legacy", "global"].includes(inputs.portfolio_mode)) fail("unsupported portfolio mode.");
  integer(count, 1, 150, "lineup count");
  if (!OBJECTIVES.some(goal => goal.id === inputs.objective)) fail("unsupported objective.");
  integer(inputs.salary_cap, 1, 50000, "salary cap"); integer(inputs.min_salary, 0, inputs.salary_cap, "minimum salary");
  integer(inputs.max_per_team, 0, 9, "maximum players per team"); integer(inputs.max_overlap, 0, 9, "overlap bound");
  if (inputs.portfolio_mode === "legacy" && inputs.max_overlap === 9) fail("legacy Classic plans require at least one changed athlete; maximum overlap must be eight or less.");
  integer(inputs.qb_stack_count, 0, 3, "legacy QB stack count");
  for (const key of ["max_exposure", "randomness"]) if (typeof inputs[key] !== "number" || !Number.isFinite(inputs[key]) || inputs[key] < 0 || inputs[key] > 1) fail(`invalid ${key}.`);
  for (const key of ["require_qb_stack", "stack_bring_back", "block_qb_opposing_dst"]) if (typeof inputs[key] !== "boolean") fail(`invalid ${key}.`);
  if (inputs.portfolio_mode === "legacy" && inputs.require_qb_stack && inputs.qb_stack_count === 0)
    fail("A legacy plan requiring a QB stack must choose a QB stack count of at least 1; explicit zero turns that stack off. Choose count 1 or higher before previewing the plan.");
  const locked = ids(inputs.locked_player_ids, players, "Locks"), excluded = ids(inputs.excluded_player_ids, players, "Exclusions");
  if (locked.some(player => excluded.includes(player))) fail("a player is both locked and excluded.");
  if (locked.length > 9) fail("more than nine global locks cannot fit a Classic roster.");
  const qbIds = ids(inputs.stack_qb_ids, players, "Selected quarterbacks");
  if (qbIds.some(player => identity(players.get(player)).position !== "QB" || excluded.includes(player))) fail("selected quarterback is excluded or is not a QB.");
  if (!Array.isArray(inputs.stack_teams) || inputs.stack_teams.some(team => typeof team !== "string" || !team || ![...players.values()].some(player => identity(player).team === team)) || new Set(inputs.stack_teams).size !== inputs.stack_teams.length)
    fail("selected stack teams are missing, repeated or absent from this slate.");
  const games = options.games ?? [], gameIds = new Set();
  if (!Array.isArray(games)) fail("load the slate games before validating a planning schedule.");
  if (!Array.isArray(inputs.stack_game_weights) || inputs.stack_game_weights.length > 32) fail("invalid planning schedule.");
  for (const scheduled of inputs.stack_game_weights) {
    shape(scheduled, ["game_id", "teams", "weight"]); text(scheduled.game_id, "Game ID"); integer(scheduled.weight, 1, 4, "game weight");
    const matches = games.filter(game => String(game.game_id) === scheduled.game_id);
    if (gameIds.has(scheduled.game_id) || matches.length !== 1 || !Array.isArray(scheduled.teams) || scheduled.teams.length !== 2 ||
        new Set(scheduled.teams).size !== 2 || canonical([...scheduled.teams].sort()) !== canonical([matches[0].home, matches[0].away].map(normalizeDfsTeam).sort()))
      fail("planning schedule has an unknown, repeated or contradictory game identity.");
    gameIds.add(scheduled.game_id);
  }
  const rules = inputs.classic_stack_rules = normalizeClassicStackRules(inputs.classic_stack_rules, options.catalog);
  if (inputs.portfolio_mode === "global" && (inputs.require_qb_stack || inputs.qb_stack_count || inputs.stack_bring_back))
    fail("Global plans use native stack rules; clear legacy QB stack and bring-back choices before importing or applying this plan.");
  if (rules && (inputs.portfolio_mode !== "global" || inputs.require_qb_stack || inputs.qb_stack_count || inputs.stack_bring_back)) fail("native stack rules require global mode and cleared legacy stack choices.");
  if (inputs.portfolio_mode === "global" && inputs.stack_game_weights.length) fail("weighted legacy planning schedules are unsupported in global mode.");
  if (rules?.attachments.receiving_rb_ids.some(player => excluded.includes(player))) fail("a declared receiving attachment is excluded.");
  const lockedQbs = locked.filter(player => identity(players.get(player)).position === "QB");
  if (lockedQbs.length > 1) fail("two locked quarterbacks cannot fit one Classic lineup.");
  if (rules && lockedQbs.length) {
    const qb = players.get(lockedQbs[0]), qbTeam = identity(qb).team;
    const game = games.find(candidate => [candidate.home, candidate.away].map(normalizeDfsTeam).includes(qbTeam));
    const opponent = normalizeDfsTeam(qb.Opponent ?? qb.opponent) || (game ? [game.home, game.away].map(normalizeDfsTeam).find(team => team !== qbTeam) : "");
    const receiving = new Set(rules.attachments.receiving_rb_ids);
    for (const [section, team] of [["attachments", qbTeam], ["bring_back", opponent]]) {
      const rule = rules[section];
      if (rule.mode === "optional") continue;
      if (!team || (section === "bring_back" && team === qbTeam)) fail(`locked quarterback has unknown or contradictory ${section} relationship.`);
      const potential = [...players.values()].filter(player => {
        const member = identity(player);
        return !excluded.includes(member.player_id) && member.team === team && (section === "bring_back"
          ? ["RB", "WR", "TE"].includes(member.position) : ["WR", "TE"].includes(member.position) || (member.position === "RB" && receiving.has(member.player_id)));
      });
      const lockedCount = potential.filter(player => locked.includes(player.player_id)).length;
      const lower = ["minimum", "exact"].includes(rule.mode) ? rule.count : 0;
      const upper = ["maximum", "exact", "forbidden"].includes(rule.mode) ? rule.count : 7;
      if (lockedCount > upper || potential.length < lower) fail(`${section} contradicts existing locks, exclusions or available eligible players.`);
    }
  }
  if (!object(inputs.player_exposure_limits) || Object.keys(inputs.player_exposure_limits).length > 500 || Object.keys(inputs.player_exposure_limits).some(player => !players.has(player))) fail("player exposures reference an unknown or ineligible ID.");
  if (!Array.isArray(inputs.group_exposure_limits) || inputs.group_exposure_limits.length > 100) fail("invalid group exposure list.");
  if (inputs.portfolio_mode === "legacy" && (Object.keys(inputs.player_exposure_limits).length || inputs.group_exposure_limits.length)) fail("native player/group exposures require global mode.");
  const shared = exposureBoundCount(inputs.max_exposure, count, "max"), referenced = new Set([...locked, ...excluded, ...qbIds, ...Object.keys(inputs.player_exposure_limits), ...(rules?.attachments.receiving_rb_ids || [])]);
  const checkBounds = (rule, members, maximum) => {
    shape(rule, ["min", "target", "max"], []);
    const lower = exposureBoundCount(rule.min ?? 0, count, "min"), upper = Math.min(maximum, exposureBoundCount(rule.max ?? 1, count, "max"));
    if (rule.target != null) exposureBoundCount(rule.target, count, "target");
    if (lower > upper || (members.some(player => excluded.includes(player)) && lower > 0) || (members.every(player => locked.includes(player)) && upper < count))
      fail("exposure bounds contradict locks, exclusions or the shared maximum.");
  };
  for (const [player, rule] of Object.entries(inputs.player_exposure_limits)) checkBounds(rule, [player], shared);
  if (inputs.portfolio_mode === "global" && locked.some(player => !Object.hasOwn(inputs.player_exposure_limits, player) && shared < count)) fail("global locks conflict with the shared maximum.");
  const groupIds = new Set();
  for (const group of inputs.group_exposure_limits) {
    shape(group, ["id", "player_ids", "min", "target", "max"], ["id", "player_ids"]); id(group.id);
    if (groupIds.has(group.id)) fail("group rule IDs repeat."); groupIds.add(group.id);
    const members = ids(group.player_ids, players, "Group");
    if (members.length < 2 || members.length > 9) fail("groups require two through nine players.");
    members.forEach(player => referenced.add(player));
    checkBounds(Object.fromEntries(["min", "target", "max"].filter(key => Object.hasOwn(group, key)).map(key => [key, group[key]])), members, count);
  }
  return { players, referenced };
}
function validatePlan(plan, options) {
  boundedJson(plan);
  shape(plan, ["schema", "version", "id", "label", "context", "player_identities", "inputs"]);
  if (plan.schema !== BUILD_PLAN_SCHEMA || plan.version !== BUILD_PLAN_VERSION) fail("unsupported schema or version.");
  id(plan.id); text(plan.label, "Display label");
  shape(plan.context, ["site", "season", "week", "slate_id", "salary_snapshot_id"]);
  integer(plan.context.season, 2000, 2200, "season"); integer(plan.context.week, 1, 22, "week");
  text(plan.context.slate_id, "Slate ID", 100, true);
  if (plan.context.salary_snapshot_id !== null) text(plan.context.salary_snapshot_id, "Salary snapshot ID");
  if (canonical(plan.context) !== canonical(slateIdentity(options))) fail("plan belongs to a different slate, week or salary snapshot.");
  shape(plan.inputs, BUILD_PLAN_INPUT_KEYS);
  if (BUILD_PLAN_INPUT_KEYS.some(key => key !== "classic_stack_rules" && plan.inputs[key] == null)) fail("complete plan fields must explicitly contain their replacement value.");
  const inputs = normalizeInputs(plan.inputs), { players, referenced } = validateInputs(inputs, options);
  if (!Array.isArray(plan.player_identities) || plan.player_identities.length > 5000) fail("invalid player identities.");
  const identities = new Map();
  for (const player of plan.player_identities) {
    shape(player, ["player_id", "dfs_id", "team", "position"]);
    if (identities.has(player.player_id) || !players.has(player.player_id) || canonical(player) !== canonical(identity(players.get(player.player_id))))
      fail("player identity differs from the loaded slate; names cannot substitute for IDs.");
    identities.set(player.player_id, player);
  }
  if ([...referenced].some(player => !identities.has(player))) fail("a requested player is missing its immutable identity.");
  return freezeSnapshot({ ...plan, inputs });
}

/** Create a complete portable plan from the current canonical optimizer request. */
export function createBuildPlan({ id: planId, label }, currentInputs, options) {
  const inputs = normalizeInputs(currentInputs), { players, referenced } = validateInputs(inputs, options);
  return validatePlan({ schema: BUILD_PLAN_SCHEMA, version: BUILD_PLAN_VERSION, id: planId, label,
    context: slateIdentity(options), player_identities: [...referenced].sort().map(player => identity(players.get(player))), inputs }, options);
}
export function readBuildPlan(value, options) {
  if (typeof value !== "string" || new TextEncoder().encode(value).length > BUILD_PLAN_MAX_BYTES) fail("file exceeds 512 KiB or is not JSON text.");
  let plan; try { plan = JSON.parse(value); } catch { fail("invalid JSON."); }
  return validatePlan(plan, options);
}
export function writeBuildPlan(plan, options) { return JSON.stringify(validatePlan(plan, options), null, 2); }

/** Validation and a detached diff finish before any caller changes live state. */
export function previewBuildPlan(value, currentInputs, options) {
  const plan = validatePlan(value, options), previous = normalizeInputs(currentInputs);
  const replacement = { ...structuredClone(currentInputs), ...structuredClone(plan.inputs) };
  const changes = BUILD_PLAN_INPUT_KEYS.filter(key => canonical(previous[key]) !== canonical(plan.inputs[key]))
    .map(field => ({ field, before: previous[field], after: plan.inputs[field] }));
  const manifest = { schema: "scoresense_build_plan_application_v1", planId: plan.id, planVersion: plan.version, label: plan.label, context: plan.context,
    requested: plan.inputs, previous, applied: normalizeInputs(replacement), changes, matches: true };
  return freezeSnapshot({ plan, replacement, manifest, previousFingerprint: canonical(currentInputs) });
}
/** Reject stale previews, then return one complete replacement transaction. */
export function applyBuildPlan(preview, currentInputs, options) {
  if (preview?.previousFingerprint !== canonical(currentInputs)) fail("settings changed after preview; preview the plan again.");
  const fresh = previewBuildPlan(preview.plan, currentInputs, options);
  assertBuildPlanApplied(fresh.manifest, fresh.replacement);
  return freezeSnapshot({ inputs: fresh.replacement, manifest: fresh.manifest });
}
/** Call with the actual optimizer payload immediately before Build. */
export function assertBuildPlanApplied(manifest, actualInputs) {
  if (manifest?.schema !== "scoresense_build_plan_application_v1" || !object(manifest.requested)) fail("missing applied-plan manifest.");
  for (const key of ["site", "season", "week", "slate_id", "salary_snapshot_id"]) {
    const actual = key === "slate_id" ? String(actualInputs[key] || "") : actualInputs[key];
    const requested = key === "slate_id" ? String(manifest.context?.[key] || "") : manifest.context?.[key];
    if (Object.hasOwn(actualInputs, key) && actual !== requested) fail(`requested plan differs from the actual ${key} identity.`);
  }
  const applied = normalizeInputs(actualInputs), requestedComparable = comparisonInputs(manifest.requested), appliedComparable = comparisonInputs(applied);
  const mismatches = BUILD_PLAN_INPUT_KEYS.filter(key => canonical(requestedComparable[key]) !== canonical(appliedComparable[key]));
  if (mismatches.length) fail(`requested plan differs from applied inputs: ${mismatches.join(", ")}. Reapply or clear the named plan before Build.`);
  return freezeSnapshot({ ...manifest, applied, matches: true });
}
