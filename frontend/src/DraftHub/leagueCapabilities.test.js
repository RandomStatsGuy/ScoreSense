import assert from "node:assert/strict";
import test from "node:test";
import {
  leagueCapabilitiesFromContext,
  leagueUsesContracts,
  leagueUsesPriorityClaims,
  leagueUsesSalaries,
  capabilitiesFromRules,
  rulesUseContracts,
} from "./leagueCapabilities.js";

test("missing capabilities keep salary-cap defaults", () => {
  const caps = leagueCapabilitiesFromContext({});
  assert.equal(caps.uses_salaries, true);
  assert.equal(caps.acquisition_mode, "bid");
  assert.equal(leagueUsesSalaries({}), true);
});

test("pick-draft capabilities hide money and use priority claims", () => {
  const ctx = {
    capabilities: {
      version: 1,
      economics: "none",
      uses_salaries: false,
      uses_contracts: false,
      acquisition_mode: "priority",
    },
  };
  assert.equal(leagueUsesSalaries(ctx), false);
  assert.equal(leagueUsesContracts(ctx), false);
  assert.equal(leagueUsesPriorityClaims(ctx), true);
  assert.equal(leagueCapabilitiesFromContext(ctx).economics, "none");
});

test("capabilities derive from rules for components handed rules, not context", () => {
  assert.equal(rulesUseContracts({ draft_type: "auction" }), true);
  assert.equal(rulesUseContracts({ draft_type: "snake" }), false);
  assert.equal(rulesUseContracts({ draft_type: "linear" }), false);
  // Unknown rules must not silently hide money from a salary league.
  assert.equal(rulesUseContracts(null), true);
  assert.equal(rulesUseContracts({}), true);
  assert.deepEqual(capabilitiesFromRules({ draft_type: "snake" }), {
    economics: "none",
    uses_salaries: false,
    uses_contracts: false,
    acquisition_mode: "priority",
  });
});
