import test from "node:test";
import assert from "node:assert/strict";
import { formatDraftEvent } from "./draftRoomHelpers.js";
import { auctionAwardContractLabel } from "./rosterFormat.js";

test("formatDraftEvent describes mid-draft trades", () => {
  assert.equal(
    formatDraftEvent({ event_type: "trade", payload: { summary: "A ↔ B · Puka (A → B)" } }),
    "Trade · A ↔ B · Puka (A → B)",
  );
  assert.equal(formatDraftEvent({ event_type: "trade", payload: {} }), "Trade completed");
});

test("formatDraftEvent describes nomination timeout skip", () => {
  assert.equal(
    formatDraftEvent({
      event_type: "pass",
      payload: { reason: "nomination_timeout", team_name: "Bob" },
    }),
    "Bob skipped — nomination clock expired",
  );
});

test("auctionAwardContractLabel describes locked rookie and vet deals", () => {
  assert.equal(
    auctionAwardContractLabel({
      contract_type: "rookie",
      contract_years: 2,
      salary: 39,
      salary_schedule: [39, 39],
    }),
    "Rookie deal · 2y · $39 → $39",
  );
  assert.equal(
    auctionAwardContractLabel({
      contract_type: "veteran",
      contract_years: 2,
      salary: 20,
      step_up_per_year: 5,
      salary_schedule: [20, 25],
    }),
    "Veteran deal · 2y · $20 → $25",
  );
});
