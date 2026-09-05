import assert from "node:assert/strict";
import test from "node:test";
import {
  contractSchedule,
  glanceEyebrow,
  isRulesFormDirty,
  mergeLeagueRules,
  presetRulesFromList,
  RULES_COPY,
  rulesFormWarnings,
  rulesSaveDisabledReason,
  rulesSummary,
  snapshotRulesForm,
  templateConfirmMessage,
  templateImpact,
  validateLeagueSettings,
} from "./rulesPresentation.js";

test("mergeLeagueRules adds new contract policy defaults without losing roster rules", () => {
  const merged = mergeLeagueRules({
    salary_cap: 240,
    roster: { qb: { min: 1, max: 3 } },
    contracts: { max_years: 4 },
  });
  assert.equal(merged.salary_cap, 240);
  assert.deepEqual(merged.roster.qb, { min: 1, max: 3, starter: 1 });
  assert.equal(merged.roster.rb.min, 4);
  assert.equal(merged.contracts.max_years, 4);
  assert.equal(merged.contracts.veteran_years, 2);
  assert.equal(merged.contracts.rookie_salary_static, true);
});

test("validateLeagueSettings catches conflicting contract and roster limits", () => {
  const rules = mergeLeagueRules({
    contracts: { max_years: 2, rookie_years: 3, veteran_years: 4 },
    roster: { te: { min: 4, max: 2 } },
  });
  const errors = validateLeagueSettings({ name: "Cap League", season: 2026, rules });
  assert.match(errors.rookie_years, /cannot exceed/i);
  assert.match(errors.veteran_years, /cannot exceed/i);
  assert.match(errors.roster_te, /cannot exceed/i);
});

test("contractSchedule and rulesSummary explain flat versus stepped rookie deals", () => {
  assert.deepEqual(contractSchedule(10, 3, 5, true), [10, 10, 10]);
  assert.deepEqual(contractSchedule(10, 3, 5, false), [10, 15, 20]);
  const summary = rulesSummary(mergeLeagueRules({
    contracts: { rookie_years: 3, rookie_salary_static: false },
  }));
  assert.match(summary.find((item) => item.id === "rookie").value, /3 years · Steps up/);
});

test("explicit null roster size reads as position limits, never 'null players'", () => {
  const summary = rulesSummary({ roster_size_max: null });
  const roster = summary.find((item) => item.id === "roster");
  assert.equal(roster.value, "Position limits");
  assert.ok(!JSON.stringify(summary).includes("null"));
  // Legacy leagues without the field still get the default.
  const withDefault = rulesSummary({});
  assert.equal(withDefault.find((item) => item.id === "roster").value, "27 players");
});

test("validateLeagueSettings allows null roster size (no explicit cap)", () => {
  const rules = mergeLeagueRules({ roster_size_max: null });
  const errors = validateLeagueSettings({ name: "Cap League", season: 2026, rules });
  assert.equal(errors.roster_size_max, undefined);
  // A number below the position minimums is still rejected.
  const bad = validateLeagueSettings({
    name: "Cap League",
    season: 2026,
    rules: mergeLeagueRules({ roster_size_max: 3 }),
  });
  assert.match(bad.roster_size_max, /at least/i);
});

test("rules copy names the silent-change cost and keeps the caveat next to Save", () => {
  assert.match(RULES_COPY.support, /strands/i);
  assert.doesNotMatch(RULES_COPY.support, /migration/i);
  assert.match(RULES_COPY.saveFootnote, /does not rewrite existing/i);
  assert.match(RULES_COPY.templatesHelp, /does not save|unsaved until you press Save/i);
  assert.doesNotMatch(JSON.stringify(RULES_COPY), /Submit|Draft Hub|permission/i);
});

test("dirty snapshot ignores equivalent number formatting", () => {
  const saved = { name: "My Auction", season: 2026, rules: mergeLeagueRules({}) };
  const current = {
    name: "My Auction",
    season: 2026,
    rules: mergeLeagueRules({ salary_cap: 200 }),
  };
  assert.equal(isRulesFormDirty(current, saved), false);
  assert.equal(snapshotRulesForm(current), snapshotRulesForm(saved));
  assert.equal(
    isRulesFormDirty({ ...current, rules: mergeLeagueRules({ salary_cap: 180 }) }, saved),
    true,
  );
});

test("save stays off until the form is dirty and valid", () => {
  assert.equal(rulesSaveDisabledReason({ dirty: false, errorCount: 0 }), RULES_COPY.noChanges);
  assert.equal(rulesSaveDisabledReason({ dirty: true, errorCount: 2 }), RULES_COPY.fixBeforeSave);
  assert.equal(rulesSaveDisabledReason({ dirty: true, errorCount: 0 }), "");
  assert.equal(glanceEyebrow(true), RULES_COPY.glancePreview);
  assert.equal(glanceEyebrow(false), RULES_COPY.glanceSaved);
});

test("warnings name a fixed-point range and a short live roster", () => {
  const rules = mergeLeagueRules({
    roster: {
      qb: { min: 4, max: 4 },
      rb: { min: 8, max: 8 },
      wr: { min: 8, max: 8 },
      te: { min: 3, max: 3 },
      k: { min: 2, max: 2 },
      def: { min: 2, max: 2 },
    },
    roster_size_max: 28,
  });
  const warnings = rulesFormWarnings({
    rules,
    roster: [
      { position: "QB", roster_status: "active" },
      { position: "RB", roster_status: "active" },
    ],
  });
  assert.match(warnings.fixed_point, /fixed 27-player demand/);
  assert.match(warnings.live_roster, /require 27 players. This roster has 2/);
  assert.match(warnings.live_positions, /QB, RB, WR, TE, K, DEF/i);
});

test("template impact names format, cap, and roster changes and does not save", () => {
  const current = mergeLeagueRules({});
  const snake = mergeLeagueRules({
    draft_type: "snake",
    salary_cap: 0,
    roster_size_max: 16,
    roster: {
      qb: { min: 1, max: 3 },
      rb: { min: 2, max: 8 },
      wr: { min: 2, max: 8 },
      te: { min: 1, max: 3 },
      k: { min: 1, max: 2 },
      def: { min: 1, max: 2 },
    },
  });
  const impact = templateImpact(current, snake);
  assert.ok(impact.some((line) => /Snake/i.test(line)));
  assert.ok(impact.some((line) => /none/i.test(line)));
  assert.ok(impact.some((line) => /16/.test(line)));
  const message = templateConfirmMessage({ label: "Snake draft", rules: snake }, current);
  assert.match(message, /does not save/i);
  assert.match(message, /Snake draft/);
  assert.ok(presetRulesFromList({ rules: snake }));
  assert.equal(presetRulesFromList({ label: "Snake draft" }), null);
});
