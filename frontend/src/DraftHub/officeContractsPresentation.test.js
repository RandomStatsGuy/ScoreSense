import assert from "node:assert/strict";
import test from "node:test";
import {
  OFFICE_CONTRACTS_COPY,
  applyPendingToBlock,
  capFieldFigures,
  contractStateChip,
  cutButtonCopy,
  isLeavingContractsPath,
  mergePendingChange,
  pendingNeedsOverrideNote,
  pendingTraySummary,
  salaryInputMax,
  salaryRoomForRow,
  summarizePending,
  teamCapStats,
  validatePendingForTeam,
  validateSalaryValue,
} from "./officeContractsPresentation.js";

const RULES = { contracts: { cut_refund_pct: 0.5, max_years: 3 } };
const TEAM = {
  team: { id: "t1", name: "Alpha" },
  roster: [
    {
      player_id: "p1",
      player_name: "Jayden Daniels",
      salary: 11,
      contract_years: 2,
      contract: { years_remaining: 2, contract_type: "rookie" },
      roster_status: "active",
    },
    {
      player_id: "p2",
      player_name: "Veteran",
      salary: 8,
      contract_years: 1,
      contract: { years_remaining: 1, contract_type: "veteran" },
      roster_status: "active",
    },
  ],
};

test("contract-state chips use keep / caution / cut tones", () => {
  assert.deepEqual(
    contractStateChip({
      rosterStatus: "active",
      yearsLeft: 1,
      contractType: "rookie",
      draftCompleted: false,
    }),
    { label: "Extend to keep", tone: "keep" },
  );
  assert.deepEqual(
    contractStateChip({
      rosterStatus: "active",
      yearsLeft: 1,
      contractType: "veteran",
      draftCompleted: false,
    }),
    { label: "Expires — FA", tone: "warn" },
  );
  assert.deepEqual(
    contractStateChip({ rosterStatus: "cut_before_draft", yearsLeft: 2, contractType: "veteran" }),
    { label: "Cut", tone: "cut" },
  );
});

test("cut control names the room and dead consequence", () => {
  const copy = cutButtonCopy(TEAM.roster[1], RULES);
  assert.match(copy.label, /Cut · \+\$4 room, \$4 dead/);
  assert.match(copy.ariaLabel, /Queue cut of Veteran/);
});

test("pending tray summarizes count, cap impact, and drops", () => {
  const pending = {
    p2: { playerId: "p2", drop: true },
    p1: { playerId: "p1", salary: 16 },
  };
  const summary = summarizePending([TEAM], pending, 200, RULES);
  assert.equal(summary.count, 2);
  assert.equal(summary.dropCount, 1);
  assert.equal(pendingTraySummary(summary), "2 changes · +$3 cap impact · 1 drop");
});

test("mistyped 110 against remaining room fails validation", () => {
  const stats = teamCapStats(TEAM, 200, RULES);
  assert.equal(stats.remaining, 181);
  const max = salaryInputMax({ remaining: stats.remaining, currentSalary: 11, isCut: false });
  assert.equal(max, 192);
  assert.match(validateSalaryValue(110, 20), /exceeds remaining room \(\$20\)/);
  assert.equal(validateSalaryValue(11, 20), "");
});

test("pending salary over remaining room is a field error", () => {
  const pending = { p1: { playerId: "p1", salary: 110 } };
  const tight = {
    ...TEAM,
    roster: TEAM.roster.map((r) => (r.player_id === "p2" ? { ...r, salary: 180 } : r)),
  };
  const room = salaryRoomForRow(tight, pending, tight.roster[0], 200, RULES);
  assert.ok(room < 110);
  const errors = validatePendingForTeam(tight, pending, 200, RULES);
  assert.ok(errors.some((e) => e.playerId === "p1"));
});

test("queued drop is excluded from the applied roster", () => {
  const next = applyPendingToBlock(TEAM, { p2: { playerId: "p2", drop: true } });
  assert.equal(next.roster.length, 1);
  assert.equal(next.roster[0].player_id, "p1");
});

test("mergePendingChange drops no-op edits", () => {
  const pending = mergePendingChange({}, "p1", { salary: 11 }, TEAM.roster[0]);
  assert.deepEqual(pending, {});
  const next = mergePendingChange({}, "p1", { salary: 16 }, TEAM.roster[0]);
  assert.equal(next.p1.salary, 16);
});

test("salary/year/status writes need an override note; drop-only does not", () => {
  assert.equal(pendingNeedsOverrideNote({ p1: { salary: 16 } }), true);
  assert.equal(pendingNeedsOverrideNote({ p1: { drop: true } }), false);
});

test("cap field figures name free and dead", () => {
  assert.equal(capFieldFigures({ free: 12, dead: 5 }), "Free $12 · dead $5");
});

test("copy stays off Submit and Draft Hub", () => {
  assert.doesNotMatch(OFFICE_CONTRACTS_COPY.save, /Submit|Draft Hub|permission/i);
  assert.doesNotMatch(OFFICE_CONTRACTS_COPY.refreshSupport, /Submit|Draft Hub|permission/i);
  assert.match(OFFICE_CONTRACTS_COPY.refreshSupport, /staff contract edits/);
});

test("leaving contracts path detects destination changes", () => {
  assert.equal(
    isLeavingContractsPath("/hub/roster-management/contracts", "/hub/cap"),
    true,
  );
  assert.equal(
    isLeavingContractsPath("/hub/roster-management/contracts", "/hub/roster-management/contracts?player=1"),
    false,
  );
  assert.equal(
    isLeavingContractsPath("/hub/roster-management/contracts", "/hub/roster-management/sheets"),
    true,
  );
});
