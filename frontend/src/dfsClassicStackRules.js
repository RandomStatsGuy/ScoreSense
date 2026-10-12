import { normalizeDfsTeam } from "./dfsToolPresentation.js";

const object = value => value && typeof value === "object" && !Array.isArray(value);
const fail = reason => { throw new Error(`Classic stack rules: ${reason}`); };
const shape = (value, keys, required = keys) => {
  if (!object(value) || Object.keys(value).some(key => !keys.includes(key)) || required.some(key => !Object.hasOwn(value, key))) fail("invalid or incomplete rule fields.");
};
const modes = ["minimum", "maximum", "exact", "optional", "forbidden"];
const relationshipTeam = value => {
  const team = normalizeDfsTeam(value);
  return team === "BYE" ? "" : team;
};
export const DEFAULT_CLASSIC_STACK_RULES = Object.freeze({ version: 1,
  attachments: Object.freeze({ mode: "optional", count: 0, receiving_rb_ids: Object.freeze([]) }),
  bring_back: Object.freeze({ mode: "optional", count: 0 }) });

/** Canonical IDs declare RB eligibility; this does not infer receiving roles. */
export function normalizeClassicStackRules(value, catalog = null) {
  if (value == null) return null;
  shape(value, ["version", "attachments", "bring_back"], ["version"]);
  if (value.version !== 1) fail("unsupported version.");
  const attachments = value.attachments === undefined ? DEFAULT_CLASSIC_STACK_RULES.attachments : value.attachments;
  const bringBack = value.bring_back === undefined ? DEFAULT_CLASSIC_STACK_RULES.bring_back : value.bring_back;
  shape(attachments, ["mode", "count", "receiving_rb_ids"], ["mode", "count"]);
  shape(bringBack, ["mode", "count"]);
  for (const rule of [attachments, bringBack]) {
    if (!modes.includes(rule.mode) || !Number.isSafeInteger(rule.count) || rule.count < 0 || rule.count > 7 ||
        (["optional", "forbidden"].includes(rule.mode) && rule.count !== 0)) fail("choose a supported mode and whole count; optional and forbidden use zero.");
  }
  const ids = attachments.receiving_rb_ids === undefined ? [] : attachments.receiving_rb_ids;
  if (!Array.isArray(ids) || ids.length > 500 || ids.some(id => typeof id !== "string" || !id.trim() || id.length > 100) || new Set(ids).size !== ids.length)
    fail("receiving RBs require distinct canonical player IDs.");
  if (catalog) {
    const players = new Map(catalog.map(player => [player.player_id, player]));
    if (ids.some(id => !players.has(id) || String(players.get(id).Position ?? players.get(id).position).toUpperCase() !== "RB"))
      fail("a declared receiving RB is missing or is not an RB in this slate.");
  }
  return { version: 1, attachments: { mode: attachments.mode, count: attachments.count, receiving_rb_ids: [...ids].sort() },
    bring_back: { mode: bringBack.mode, count: bringBack.count } };
}

/** Independent actual-roster check; every existing lock naturally counts once. */
export function auditClassicStackRules(value, entry, catalog, originalPlayers = []) {
  const rules = normalizeClassicStackRules(value, catalog);
  if (!rules) return null;
  const qb = entry.lineup.find(row => row.slot === "QB"), qbTeam = relationshipTeam(qb?.team);
  if (!qb) fail("the lineup is missing its quarterback.");
  const players = new Map(catalog.map(player => [player.player_id, player]));
  const provenance = new Map(originalPlayers.map(player => [player.player_id, player]));
  const qbInfo = provenance.get(qb.player_id) || players.get(qb.player_id);
  const opponent = relationshipTeam(qbInfo?.opponent ?? qbInfo?.Opponent);
  const rbIds = new Set(rules.attachments.receiving_rb_ids);
  const eligibleAttachments = entry.lineup.filter(row =>
    (["WR", "TE"].includes(String(row.position).toUpperCase()) || (String(row.position).toUpperCase() === "RB" && rbIds.has(row.player_id))));
  const eligibleOpponents = entry.lineup.filter(row => ["RB", "WR", "TE"].includes(String(row.position).toUpperCase()));
  const attachmentsKnown = qbTeam && eligibleAttachments.every(row => relationshipTeam(row.team));
  const attachments = eligibleAttachments.filter(row => qbTeam && relationshipTeam(row.team) === qbTeam);
  const opponentKnown = qbTeam && opponent && opponent !== qbTeam && eligibleOpponents.every(row => relationshipTeam(row.team));
  const bringBack = eligibleOpponents.filter(row => opponentKnown && relationshipTeam(row.team) === opponent);
  const inspect = (name, rule, rows, identityKnown) => {
    if (rule.mode !== "optional" && !identityKnown) fail(`${name} cannot be checked because quarterback team/opponent identity is unknown.`);
    const actual = rows.length;
    if ((rule.mode === "minimum" && actual < rule.count) || (rule.mode === "maximum" && actual > rule.count) ||
        (rule.mode === "exact" && actual !== rule.count) || (rule.mode === "forbidden" && actual !== 0))
      fail(`${name} requested ${rule.mode} ${rule.count}, actual ${actual}.`);
    return { mode: rule.mode, count: rule.count, actual_count: actual, player_ids: rows.map(row => row.player_id).sort(),
      relationship_known: Boolean(identityKnown) };
  };
  return { version: 1, ok: true, qb_id: qb.player_id, receiving_rb_eligibility: "user-declared canonical IDs",
    attachments: inspect("attachments", rules.attachments, attachments, attachmentsKnown),
    bring_back: inspect("bring-back", rules.bring_back, bringBack, opponentKnown), issues: [] };
}
