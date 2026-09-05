import assert from "node:assert/strict";
import test from "node:test";
import { contractDeadCapStory } from "./rosterFormat.js";

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
});

test("active contract if-undone value is a dash, not a label prefix", () => {
  const story = contractDeadCapStory({ player_name: "Active", salary: 10, roster_status: "active" }, RULES);
  assert.equal(story.deadLabel, "$5");
  assert.equal(story.ifUndoneLabel, "—");
});
