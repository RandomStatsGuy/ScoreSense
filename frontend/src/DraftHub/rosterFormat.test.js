import assert from "node:assert/strict";
import test from "node:test";
import {
  CONTRACT_TYPE_OPTIONS,
  contractDeadCapStory,
  auctionAwardContractLabel,
  contractTypeLabel,
  dealCanTakeExtension,
  dealSalaryIsStatic,
  joinSalarySchedule,
  previewSchedule,
  rosterSlotKey,
} from "./rosterFormat.js";

test("rosterSlotKey is empty when the row is missing", () => {
  assert.equal(rosterSlotKey(undefined), "");
  assert.equal(rosterSlotKey(null), "");
  assert.equal(rosterSlotKey({ player_id: "p1" }), "p1");
  assert.equal(rosterSlotKey({ id: 44, player_id: "p1" }), "slot-44");
});

const RULES = { contracts: { cut_refund_pct: 0.5 } };
const ZAMIR = { player_name: "Zamir White", salary: 10, roster_status: "cut_before_draft" };

test("Cap and My team share one dead-cap story", () => {
  const story = contractDeadCapStory(ZAMIR, RULES);
  assert.equal(story.salary, 10);
  assert.equal(story.dead, 5);
  assert.equal(story.freed, 5);
  assert.equal(story.isCut, true);
  assert.equal(story.cutBullet, "frees $5, dead $5");
  assert.equal(story.deadLabel, "$5");
  assert.equal(story.ifUndoneLabel, "room −$10");
  assert.equal(story.railCut, "(+$5 dead, −$10 room)");
  assert.equal(story.undoSupport, "+$10 room this season, $5 dead cleared.");
  const dollar = contractDeadCapStory({ salary: 1, roster_status: "cut_before_draft" }, RULES);
  assert.equal(dollar.dead, 0);
  assert.equal(dollar.freed, 1);
  const odd = contractDeadCapStory({ salary: 7, roster_status: "active" }, RULES);
  assert.equal(odd.dead, 3);
  assert.equal(odd.freed, 4);
});

test("active contract if-undone value is a dash, not a label prefix", () => {
  const story = contractDeadCapStory({ player_name: "Active", salary: 10, roster_status: "active" }, RULES);
  assert.equal(story.deadLabel, "$5");
  assert.equal(story.ifUndoneLabel, "—");
});

test("contract types are rookie deal, vet deal, and extension", () => {
  assert.deepEqual(CONTRACT_TYPE_OPTIONS.map((o) => o.label), [
    "Rookie contract",
    "Veteran contract",
    "Extension",
  ]);
  assert.equal(contractTypeLabel("extension"), "Extension");
  assert.equal(
    auctionAwardContractLabel({
      contract_type: "extension",
      contract_years: 2,
      salary: 15,
      step_up_per_year: 5,
      salary_schedule: [15, 20],
    }),
    "Extension · 2y · $15 → $20",
  );
  assert.equal(dealCanTakeExtension("veteran"), true);
  assert.equal(dealCanTakeExtension("veteran", { contracts: { allow_veteran_renewal: false } }), false);
  assert.equal(dealCanTakeExtension("extension"), false);
  assert.equal(dealCanTakeExtension("rookie"), true);
});

test("flat salary schedules render as one figure", () => {
  assert.equal(joinSalarySchedule(["$4", "$4"]), "$4");
  assert.equal(joinSalarySchedule(["$17", "$22"]), "$17 → $22");
  assert.equal(previewSchedule(4, 2, 0, "rookie", true), "$4");
  assert.equal(previewSchedule(17, 2, 5, "veteran", true, true), "$17");
  assert.equal(previewSchedule(17, 2, 5, "veteran", true, false), "$17 → $22");
  assert.equal(dealSalaryIsStatic("veteran", { contracts: { veteran_salary_static: true } }), true);
  assert.equal(dealSalaryIsStatic("veteran", { contracts: { veteran_salary_static: false } }), false);
  assert.equal(
    auctionAwardContractLabel({
      contract_type: "veteran",
      contract_years: 2,
      salary: 12,
      veteran_salary_static: true,
    }),
    "Veteran contract · 2y · $12",
  );
});
