import assert from "node:assert/strict";
import test from "node:test";
import {
  contractSchedule,
  mergeLeagueRules,
  rulesSummary,
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
