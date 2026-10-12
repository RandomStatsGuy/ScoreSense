import { normalizeDfsTeam } from "./dfsToolPresentation.js";

const fail = reason => { throw new Error(`Global portfolio export blocked: ${reason}`); };
const object = value => value && typeof value === "object" && !Array.isArray(value);
const canonical = value => JSON.stringify(value, (_key, item) => object(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const fields = ["portfolio_mode", "lineup_count", "max_exposure", "player_exposure_limits", "group_exposure_limits",
  "max_overlap", "locked_player_ids", "excluded_player_ids", "block_qb_opposing_dst", "salary_cap", "min_salary", "max_per_team"];
const normalizedParameter = (key, value) => value ?? ({ max_exposure: 1, player_exposure_limits: {},
  group_exposure_limits: [], locked_player_ids: [], excluded_player_ids: [],
  block_qb_opposing_dst: true, min_salary: 0, max_per_team: 0 }[key]);

// Exact fraction/count arithmetic independent of the selector's reported audit.
function amount(value, count, kind) {
  if (object(value)) {
    const softDecimal = kind === "target" && typeof value.count === "string" &&
      /^(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.count);
    const number = softDecimal ? Number(value.count) : value.count;
    if (Object.keys(value).length !== 1 || !Object.hasOwn(value, "count") || typeof number !== "number" ||
        !Number.isFinite(number) || number < 0 || number > count ||
        (kind !== "target" && !Number.isSafeInteger(number))) fail("invalid exposure count bound.");
    return number;
  }
  if (!["number", "string"].includes(typeof value)) fail("invalid exposure fraction bound.");
  const match = /^(\d*)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(String(value).trim());
  if (!match || (!match[1] && !match[2]) || (match[1] + (match[2] || "")).length > 30) fail("invalid exposure fraction bound.");
  const exponent = Number(match[3] || 0), scale = (match[2] || "").length - exponent;
  if (Math.abs(scale) > 30) fail("invalid exposure fraction precision.");
  let numerator = BigInt((match[1] || "0") + (match[2] || "")), denominator = 1n;
  if (scale >= 0) denominator = 10n ** BigInt(scale); else numerator *= 10n ** BigInt(-scale);
  if (numerator > denominator) fail("exposure fractions must be between zero and one.");
  const scaled = numerator * BigInt(count);
  return kind === "min" ? Number((scaled + denominator - 1n) / denominator)
    : kind === "max" ? Number(scaled / denominator) : Number(scaled) / Number(denominator);
}

/** Audit one original global build; unrelated collected batches keep their own N. */
export function validateGlobalBuildForExport(snapshot, actualLineups = snapshot?.lineups) {
  const settings = snapshot?.settings || {}, original = settings.build_snapshot?.content?.parameters;
  const content = settings.build_snapshot?.content;
  if (settings.portfolio_mode !== "global" && original?.portfolio_mode !== "global" &&
      content?.engine?.version !== "global_candidate_milp_v1" && settings.portfolio_selection == null) return null;
  if (settings.portfolio_mode !== "global") fail("original global mode was removed from the saved snapshot settings.");
  if (original != null && !object(original)) fail("original input snapshot parameters are malformed.");
  if (original) for (const key of fields) {
    if (Object.hasOwn(original, key) && canonical(normalizedParameter(key, settings[key])) !== canonical(normalizedParameter(key, original[key])))
      fail(`${key} no longer matches the original input snapshot.`);
  }
  const count = settings.lineup_count;
  if (!Number.isSafeInteger(count) || count < 1 || count > 150 || actualLineups?.length !== count)
    fail("actual lineup count does not match the original requested count.");
  if (canonical(actualLineups) !== canonical(snapshot.lineups)) fail("lineups no longer match the reviewed original build.");
  if (!Array.isArray(snapshot.salaryCatalog) || !snapshot.salaryCatalog.length) fail("original player catalog is missing.");
  const catalog = new Map();
  for (const player of snapshot.salaryCatalog) {
    if (typeof player.player_id !== "string" || !player.player_id.trim() || catalog.has(player.player_id)) fail("player catalog has missing or duplicate canonical IDs.");
    catalog.set(player.player_id, player);
  }
  const checkIds = (values, label) => {
    if (!Array.isArray(values) || values.some(id => typeof id !== "string" || !catalog.has(id)) || new Set(values).size !== values.length)
      fail(`${label} contains an unknown or repeated canonical player ID.`);
    return values;
  };
  const locked = checkIds(settings.locked_player_ids || [], "Locks"), excluded = checkIds(settings.excluded_player_ids || [], "Skipped players");
  const overlap = settings.max_overlap;
  if (overlap != null && (!Number.isSafeInteger(overlap) || overlap < 0 || overlap > 9)) fail("invalid overlap bound.");
  const salaryCap = settings.salary_cap ?? 50000, minimumSalary = settings.min_salary ?? 0,
    maximumPerTeam = settings.max_per_team ?? 0;
  if (!Number.isSafeInteger(salaryCap) || salaryCap < 1 || salaryCap > 50000 ||
      !Number.isSafeInteger(minimumSalary) || minimumSalary < 0 || minimumSalary > salaryCap)
    fail("invalid original salary bounds.");
  if (!Number.isSafeInteger(maximumPerTeam) || maximumPerTeam < 0 || maximumPerTeam > 9)
    fail("invalid original maximum players per team.");
  if (settings.block_qb_opposing_dst != null && typeof settings.block_qb_opposing_dst !== "boolean") fail("invalid QB/opposing-DST policy.");
  const sets = [], seen = new Set();
  const eligiblePlayers = content?.eligible_players ?? [];
  if (!Array.isArray(eligiblePlayers) || eligiblePlayers.some(player => !object(player))) fail("original opponent provenance is malformed.");
  const originalPlayers = new Map(eligiblePlayers.map(p => [p.player_id, p]));
  actualLineups.forEach((entry, index) => {
    if (!Array.isArray(entry?.lineup) || entry.lineup.length !== 9) fail(`lineup ${index + 1} has invalid roster rows.`);
    const ids = checkIds(entry.lineup.map(p => p.player_id), "Lineup"), key = JSON.stringify([...ids].sort()), members = new Set(ids);
    if (seen.has(key)) fail("duplicate canonical scoring lineups remain in the original global build.");
    seen.add(key);
    if (locked.some(id => !members.has(id))) fail(`lineup ${index + 1} is missing a global lock.`);
    if (excluded.some(id => members.has(id))) fail(`lineup ${index + 1} contains a skipped player.`);
    if (overlap != null && sets.some(other => ids.filter(id => other.has(id)).length > overlap)) fail("lineups exceed the original maximum overlap.");
    let salary = 0;
    const teams = new Map();
    for (const row of entry.lineup) {
      const player = catalog.get(row.player_id), playerSalary = Number(player.salary), rowSalary = Number(row.salary);
      if (![player.salary, row.salary].every(value => ["number", "string"].includes(typeof value) && String(value).trim()) ||
          !Number.isSafeInteger(playerSalary) || playerSalary < 1 || rowSalary !== playerSalary)
        fail(`lineup ${index + 1} has an invalid salary or a salary differing from the original catalog.`);
      salary += playerSalary;
      const team = normalizeDfsTeam(player.Team ?? player.team);
      if (!team || team !== normalizeDfsTeam(row.team)) fail(`lineup ${index + 1} has missing or inconsistent team identity.`);
      teams.set(team, (teams.get(team) || 0) + 1);
    }
    if (salary < minimumSalary || salary > salaryCap)
      fail(`lineup ${index + 1} salary ${salary} falls outside original minimum ${minimumSalary} and cap ${salaryCap}.`);
    if (maximumPerTeam && [...teams.values()].some(value => value > maximumPerTeam))
      fail(`lineup ${index + 1} exceeds the original maximum ${maximumPerTeam} players per team.`);
    sets.push(members);
    if (settings.block_qb_opposing_dst !== false) {
      const qb = entry.lineup.find(p => p.slot === "QB"), dst = entry.lineup.find(p => p.slot === "DST");
      const opponent = row => {
        const player = originalPlayers.get(row?.player_id) || catalog.get(row?.player_id);
        return normalizeDfsTeam(player?.opponent ?? player?.Opponent ?? "");
      };
      const qbOpponent = opponent(qb), dstOpponent = opponent(dst), qbTeam = normalizeDfsTeam(qb?.team), dstTeam = normalizeDfsTeam(dst?.team);
      if ((qbOpponent && qbOpponent === dstTeam) || (dstOpponent && dstOpponent === qbTeam)) fail(`lineup ${index + 1} pairs its quarterback with the opposing DST.`);
      if (!((qbOpponent && dstTeam) || (dstOpponent && qbTeam))) fail(`lineup ${index + 1} has unknown QB/DST opponent identity.`);
    }
  });
  const sharedMaximum = amount(settings.max_exposure ?? 1, count, "max"), bounds = [];
  const inspect = (id, members, rule, maximum = count) => {
    if (!object(rule) || Object.keys(rule).some(key => !["min", "target", "max"].includes(key))) fail(`${id} has unsupported exposure bounds.`);
    const minimum = amount(rule.min ?? 0, count, "min"), upper = Math.min(maximum, amount(rule.max ?? 1, count, "max"));
    if (rule.target != null) amount(rule.target, count, "target");
    const actual = sets.filter(set => members.every(member => set.has(member))).length;
    if (minimum > upper || actual < minimum || actual > upper) fail(`${id}: actual ${actual}, minimum ${minimum}, maximum ${upper}.`);
    bounds.push({ id, minimum, maximum: upper, actual });
  };
  const rules = settings.player_exposure_limits ?? {};
  if (!object(rules) || Object.keys(rules).some(id => !catalog.has(id))) fail("exposure bounds reference an unknown player.");
  for (const id of catalog.keys()) inspect(id, [id], rules[id] ?? {}, sharedMaximum);
  const groups = settings.group_exposure_limits ?? [], groupIds = new Set();
  if (!Array.isArray(groups)) fail("invalid pair/core exposure bounds.");
  for (const group of groups) {
    if (!object(group) || typeof group.id !== "string" || !group.id.trim() || groupIds.has(group.id) ||
        Object.keys(group).some(key => !["id", "player_ids", "min", "target", "max"].includes(key))) fail("invalid pair/core exposure bound.");
    groupIds.add(group.id);
    const members = checkIds(group.player_ids, "Core");
    if (members.length < 2 || members.length > 9) fail("pair/core bounds require two through nine players.");
    inspect(group.id, members, Object.fromEntries(["min", "target", "max"].filter(key => Object.hasOwn(group, key)).map(key => [key, group[key]])));
  }
  return { version: 1, mode: "global", requestedCount: count, actualCount: actualLineups.length,
    uniqueCount: seen.size, bounds, lockCount: locked.length, excludedCount: excluded.length,
    salaryCap, minimumSalary, maximumPerTeam,
    qbOpposingDstPolicy: settings.block_qb_opposing_dst !== false ? "checked" : "explicit_override" };
}
