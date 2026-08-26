import test from "node:test";
import assert from "node:assert/strict";
import {
  containsAuctionLanguage,
  formatExpectedRecord,
  outcomeBandLabel,
  recapCopyIsPickDraftSafe,
  recapHeadlineForType,
  sortStandings,
  viewerInsight,
} from "./recapFormat.js";

test("pick-draft headlines name the mode", () => {
  assert.equal(recapHeadlineForType("snake"), "Snake draft in the books.");
  assert.equal(recapHeadlineForType("linear"), "Linear draft in the books.");
  assert.match(recapHeadlineForType("linear"), /Linear/);
  assert.doesNotMatch(recapHeadlineForType("linear"), /snake/i);
});

test("auction language is rejected in pick-draft recap copy", () => {
  assert.equal(containsAuctionLanguage("Cap hoarder of the night"), true);
  assert.equal(containsAuctionLanguage("Spent $44 on a reach"), true);
  assert.equal(containsAuctionLanguage("Best projected starting lineup"), false);
  const recap = {
    pick_draft: true,
    headline: "Snake draft in the books.",
    awards: [{ title: "Safest floor", detail: "120 starter pts", blurb: "Highest P10" }],
  };
  assert.equal(recapCopyIsPickDraftSafe(recap), true);
  recap.awards.push({ title: "Empty wallet", detail: "$12 left", blurb: "unspent" });
  assert.equal(recapCopyIsPickDraftSafe(recap), false);
});

test("standings sort and viewer insight", () => {
  const rows = [
    { team_id: "b", team_name: "Beta", rank: 2, expected_wins: 7, points_p50: 1400 },
    { team_id: "a", team_name: "Alpha", rank: 1, expected_wins: 11, points_p50: 1600 },
  ];
  assert.deepEqual(sortStandings(rows, "rank", "asc").map((r) => r.team_id), ["a", "b"]);
  assert.deepEqual(sortStandings(rows, "expected_wins", "desc").map((r) => r.team_id), ["a", "b"]);
  const recap = { team_insights: [{ team_id: "b", summary: "Beta grades B" }] };
  assert.equal(viewerInsight(recap, "b").summary, "Beta grades B");
  assert.equal(formatExpectedRecord({ expected_wins: 9.1, expected_losses: 4.9 }), "9.1–4.9");
  assert.equal(outcomeBandLabel("points_p10"), "Floor / P10");
  assert.equal(outcomeBandLabel("points_p50"), "Median / P50");
  assert.equal(outcomeBandLabel("points_p90"), "Ceiling / P90");
});
