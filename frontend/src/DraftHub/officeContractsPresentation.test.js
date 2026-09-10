import assert from "node:assert/strict";
import test from "node:test";
import {
  OFFICE_ACQUIRED_OPTIONS,
  OFFICE_CONTRACTS_COPY,
  applyPendingToBlock,
  capFieldFigures,
  contractStateChip,
  cutButtonCopy,
  cutConfirmCopy,
  dropButtonCopy,
  dropConfirmCopy,
  dropLeftoverFreed,
  isExpiredToFaRow,
  isLeavingContractsPath,
  mergePendingChange,
  partitionOfficeRoster,
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
    { label: "Extend to keep", tone: "keep" },
  );
  assert.deepEqual(
    contractStateChip({
      rosterStatus: "active",
      yearsLeft: 1,
      contractType: "veteran",
      draftCompleted: false,
      rules: { contracts: { allow_veteran_renewal: false } },
    }),
    { label: "Expiring", tone: "warn" },
  );
  assert.deepEqual(
    contractStateChip({
      rosterStatus: "active",
      yearsLeft: 1,
      contractType: "extension",
      draftCompleted: false,
    }),
    { label: "Expiring", tone: "warn" },
  );
  assert.equal(OFFICE_CONTRACTS_COPY.expiring, "Expiring");
  assert.doesNotMatch(OFFICE_CONTRACTS_COPY.expiring, /FA|Expires/);
  assert.deepEqual(
    contractStateChip({ rosterStatus: "cut_before_draft", yearsLeft: 2, contractType: "veteran" }),
    { label: "Cut", tone: "cut" },
  );
});

test("cut control names the room and dead consequence", () => {
  const copy = cutButtonCopy(TEAM.roster[1], RULES);
  assert.match(copy.label, /Cut · \+\$4 room, \$4 dead/);
  assert.match(copy.ariaLabel, /Queue cut of Veteran/);
  const afterDraft = cutButtonCopy(TEAM.roster[1], RULES, { draftCompleted: true });
  assert.match(afterDraft.ariaLabel, /Cut Veteran with dead cap/);
  const confirm = cutConfirmCopy(TEAM.roster[1], RULES);
  assert.equal(confirm.title, "Cut Veteran?");
  assert.match(confirm.message, /Frees \$4 leftover/);
  assert.match(confirm.message, /Dead cap \$4/);
  assert.match(confirm.message, /Drop if you meant no penalty/);
  const closed = cutButtonCopy(
    {
      player_name: "Veteran",
      roster_status: "cut_before_draft",
      can_undo_cut: false,
      claimed_by_owner: "Bravo",
    },
    RULES,
  );
  assert.equal(closed.label, "Undo cut is closed");
  assert.equal(closed.disabled, true);
  assert.match(closed.support, /Bravo's roster/);
});

test("after-draft leftover includes this-season dead cap only", () => {
  const block = {
    team: { id: "t1", name: "Alpha" },
    roster: [
      {
        player_id: "kept",
        player_name: "Kept",
        salary: 50,
        contract_years: 2,
        contract: { years_remaining: 2, contract_type: "veteran" },
        roster_status: "active",
      },
      {
        player_id: "cut",
        player_name: "Cut",
        salary: 80,
        contract_years: 3,
        contract: { years_remaining: 3, contract_type: "veteran" },
        roster_status: "cut_before_draft",
      },
    ],
  };
  const stats = teamCapStats(block, 200, RULES, true);
  assert.equal(stats.committed, 50);
  assert.equal(stats.deadCap, 40);
  assert.equal(stats.remaining, 110);
  assert.equal(stats.cutCount, 1);
});

test("drop control names leftover and zero dead cap", () => {
  const kept = dropButtonCopy(TEAM.roster[0], { draftCompleted: false });
  assert.equal(dropLeftoverFreed(TEAM.roster[0], false), 11);
  assert.match(kept.label, /Drop · \+\$11 leftover, \$0 dead/);
  assert.match(kept.ariaLabel, /no dead cap/);
  const expiree = dropButtonCopy(TEAM.roster[1], { draftCompleted: false });
  assert.equal(dropLeftoverFreed(TEAM.roster[1], false), 0);
  assert.equal(expiree.label, OFFICE_CONTRACTS_COPY.queueDrop);
  const confirm = dropConfirmCopy(TEAM.roster[0], { draftCompleted: false });
  assert.match(confirm.message, /No dead cap/);
  assert.match(confirm.message, /Cut if you meant a penalty/);
  assert.doesNotMatch(confirm.message, /Submit|Draft Hub|permission/i);
});

test("pending tray summarizes count, cap impact, and drops", () => {
  const pending = {
    p2: { playerId: "p2", drop: true },
    p1: { playerId: "p1", salary: 16 },
  };
  const summary = summarizePending([TEAM], pending, 200, RULES);
  assert.equal(summary.count, 2);
  assert.equal(summary.dropCount, 1);
  assert.equal(pendingTraySummary(summary), "2 changes · −$5 cap impact · 1 drop");
});

test("mistyped 110 against remaining room fails validation", () => {
  const stats = teamCapStats(TEAM, 200, RULES);
  assert.equal(stats.committed, 11);
  assert.equal(stats.remaining, 189);
  const max = salaryInputMax({ remaining: stats.remaining, currentSalary: 11, isCut: false });
  assert.equal(max, 200);
  assert.match(validateSalaryValue(110, 20), /exceeds remaining room \(\$20\)/);
  assert.equal(validateSalaryValue(11, 20), "");
});

test("pending salary over remaining room is a field error", () => {
  const pending = { p1: { playerId: "p1", salary: 110 } };
  const tight = {
    ...TEAM,
    roster: TEAM.roster.map((r) => (
      r.player_id === "p2"
        ? { ...r, salary: 180, contract_years: 2, contract: { ...r.contract, years_remaining: 2 } }
        : r
    )),
  };
  const room = salaryRoomForRow(tight, pending, tight.roster[0], 200, RULES);
  assert.ok(room < 110);
  const errors = validatePendingForTeam(tight, pending, 200, RULES);
  assert.ok(errors.some((e) => e.playerId === "p1"));
});

test("auction leftover ignores a 1-year keeper who expires at draft", () => {
  const stats = teamCapStats(TEAM, 200, RULES, false);
  assert.equal(stats.committed, 11);
  assert.equal(stats.remaining, 189);
  const afterDraft = teamCapStats(TEAM, 200, RULES, true);
  assert.equal(afterDraft.committed, 19);
  assert.equal(afterDraft.remaining, 181);
});

test("after draft leftover ignores Yrs-0 expirees the way Rosters does", () => {
  const block = {
    team: { id: "t1", name: "Alpha" },
    roster: [
      {
        player_id: "live",
        player_name: "Kept",
        salary: 124,
        contract_years: 1,
        contract: { years_remaining: 1, contract_type: "veteran" },
        source: "draft",
        roster_status: "active",
      },
      {
        player_id: "exp",
        player_name: "Expiree",
        salary: 35,
        contract_years: 0,
        contract: { years_remaining: 0, contract_type: "veteran" },
        roster_status: "expired",
      },
      {
        player_id: "zero",
        player_name: "Ticked",
        salary: 16,
        contract_years: 0,
        contract: { years_remaining: 0, contract_type: "veteran" },
        roster_status: "active",
      },
    ],
  };
  const stats = teamCapStats(block, 200, RULES, true);
  assert.equal(stats.committed, 124);
  assert.equal(stats.remaining, 76);
  assert.equal(stats.playerCount, 1);
  assert.equal(stats.cutCount, 0);
  const parts = partitionOfficeRoster(block.roster);
  assert.equal(parts.live.length, 1);
  assert.equal(parts.expired.length, 2);
  assert.equal(isExpiredToFaRow(block.roster[1]), true);
});

test("drop-only save is not blocked when leftover is already over", () => {
  const tight = {
    team: { id: "t1", name: "Alpha" },
    roster: [
      {
        player_id: "p1",
        player_name: "Star",
        salary: 180,
        contract_years: 2,
        contract: { years_remaining: 2, contract_type: "veteran" },
        source: "draft",
        roster_status: "active",
      },
      {
        player_id: "p2",
        player_name: "Depth",
        salary: 40,
        contract_years: 1,
        contract: { years_remaining: 1, contract_type: "veteran" },
        source: "draft",
        roster_status: "active",
      },
    ],
  };
  const before = teamCapStats(tight, 200, RULES, true);
  assert.ok(before.remaining < 0);
  const dropOnly = validatePendingForTeam(
    tight, { p2: { playerId: "p2", drop: true } }, 200, RULES, true,
  );
  assert.equal(dropOnly.length, 0);
  const raise = validatePendingForTeam(
    tight, { p1: { playerId: "p1", salary: 190 } }, 200, RULES, true,
  );
  assert.ok(raise.some((e) => e.teamId === "t1"));
});

test("after draft drop copy writes now, not queue", () => {
  const copy = dropButtonCopy(TEAM.roster[0], { draftCompleted: true });
  assert.equal(copy.label, OFFICE_CONTRACTS_COPY.dropNow);
  assert.match(copy.ariaLabel, /^Drop /);
  const confirm = dropConfirmCopy(TEAM.roster[0], { draftCompleted: true });
  assert.equal(confirm.confirmLabel, OFFICE_CONTRACTS_COPY.dropConfirmNow);
  assert.equal(OFFICE_CONTRACTS_COPY.acquiredAuction, "Auction");
  assert.equal(OFFICE_CONTRACTS_COPY.acquiredFaLottery, "FA lottery");
  assert.match(OFFICE_CONTRACTS_COPY.bidSupport, /current roster/);
  assert.deepEqual(
    OFFICE_ACQUIRED_OPTIONS.map((o) => o.value),
    ["draft", "post_draft_fa"],
  );
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

test("mergePendingChange drops the old playerId key after a slot key write", () => {
  const row = { ...TEAM.roster[0], id: 9 };
  const prev = { p1: { playerId: "p1", salary: 14 } };
  const next = mergePendingChange(prev, "p1", { salary: 16 }, row);
  assert.equal(next["slot-9"].salary, 16);
  assert.equal(next.p1, undefined);
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
  assert.match(OFFICE_CONTRACTS_COPY.refreshSupport, /commissioner edits/);
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
