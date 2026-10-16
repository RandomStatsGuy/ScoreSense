import assert from "node:assert/strict";
import test from "node:test";
import {
  notifyPartnerNames,
  packageFingerprint,
  packageLegFlow,
  partnerCardMeta,
  sendGetCopy,
  retainTradeRecipients,
  validationBanner,
} from "./tradeBuilderHelpers.js";
import { TRADES_COPY } from "./leagueTradesPresentation.js";

test("partnerCardMeta shows free cap and thin spots", () => {
  assert.equal(
    partnerCardMeta({
      stats: { unspent: 22, by_position_count: { QB: 2, RB: 6, WR: 5, TE: 0 } },
      insight: { their_need: ["TE"] },
    }),
    "$22 free · thin at TE",
  );
  assert.equal(
    partnerCardMeta({
      stats: { unspent: 10, by_position_count: { QB: 0, RB: 6, WR: 6, TE: 2, K: 1, DEF: 1 } },
    }),
    "$10 free · thin at QB",
  );
});

test("partnerCardMeta omits cap for pick leagues", () => {
  assert.equal(
    partnerCardMeta({
      stats: { unspent: -200, by_position_count: { QB: 1, RB: 2, WR: 2, TE: 0 } },
      insight: { their_need: ["TE"] },
      includeCap: false,
    }),
    "thin at TE",
  );
});

test("sendGetCopy is directional and names the player", () => {
  const yours = sendGetCopy({
    isYours: true,
    playerName: "Jayden Daniels",
    destName: "Disappointment",
    srcName: "Thanks noob noob",
  });
  assert.equal(yours.button, "Send →");
  assert.equal(yours.aria, "Send Jayden Daniels to Disappointment");
  const theirs = sendGetCopy({
    isYours: false,
    playerName: "Jayden Daniels",
    destName: "Thanks noob noob",
    srcName: "Disappointment",
  });
  assert.equal(theirs.button, "← Get");
  assert.equal(theirs.aria, "Get Jayden Daniels from Disappointment");
});

test("package vocabulary stays Send / Get / Cut", () => {
  assert.equal(packageLegFlow({ drop: true, from: "a" }, () => "Mine"), "Cut from Mine");
  assert.equal(
    packageLegFlow({ from: "a", to: "b" }, (id) => (id === "a" ? "Mine" : "Theirs")),
    "Mine → Theirs",
  );
});

test("validation banner is a live status, not grey chart-note copy", () => {
  assert.deepEqual(validationBanner("pending"), {
    variant: "info",
    live: "polite",
    role: "status",
    text: TRADES_COPY.checking,
  });
  assert.equal(validationBanner("valid").variant, "ready");
  assert.equal(validationBanner("invalid", ["Over cap"]).role, "alert");
  assert.equal(validationBanner("idle"), null);
});

test("package fingerprint changes when a send is added", () => {
  const empty = packageFingerprint([{ team_id: "a", sends: [], drops: [] }], []);
  const one = packageFingerprint(
    [{ team_id: "a", sends: [{ player_id: "p1", to_team_id: "b" }], drops: [] }],
    [],
  );
  assert.notEqual(empty, one);
});

test("notifyPartnerNames prefers owner name", () => {
  assert.deepEqual(
    notifyPartnerNames(
      [{ id: "b", owner_name: "Alex", name: "Disappointment" }],
      ["b"],
      "a",
    ),
    ["Alex"],
  );
});

test("three-team sends name the recipient rather than implying Get for your team", () => {
  assert.deepEqual(sendGetCopy({ isYours: false, multiTeam: true,
    playerName: "Player B", srcName: "B", destName: "C" }),
  { button: "Send", aria: "Send Player B to C" });
});

test("removing a partner clears its incoming legs and preserves other destinations", () => {
  const result = retainTradeRecipients([
    { team_id: "a", sends: [{ player_id: "p1", to_team_id: "c" },
      { player_id: "p2", to_team_id: "b" }], drops: [] },
    { team_id: "b", sends: [{ player_id: "p3", to_team_id: "a" }], drops: [] },
  ]);
  assert.deepEqual(result[0].sends, [{ player_id: "p2", to_team_id: "b" }]);
  assert.equal(result[1].sends[0].to_team_id, "a");
});


test("experiment snapshots isolate routing, cuts, partial dead cap and notes", async () => {
  const { cloneTradeDraft } = await import("./tradeBuilderHelpers.js");
  const original = { parties: [{ team_id: "mine", sends: [{ player_id: "a", to_team_id: "third" }], drops: ["b"],
    dead_cap_transfers: [{ roster_slot_id: 1, to_team_id: "other", amount: 7 }] }],
    deadCapAssignments: [{ player_id: "b", from_team_id: "mine", assigned_to_team_id: "third", amount: 3 }],
    proposeNote: "Version A", sourceReviewId: "review-1" };
  const next = cloneTradeDraft(original);
  next.parties[0].sends[0].to_team_id = "other";
  next.parties[0].drops.length = 0;
  next.parties[0].dead_cap_transfers[0].amount = 2;
  next.deadCapAssignments[0].assigned_to_team_id = "other";
  next.proposeNote = "Version B";
  assert.equal(original.parties[0].sends[0].to_team_id, "third");
  assert.deepEqual(original.parties[0].drops, ["b"]);
  assert.equal(original.parties[0].dead_cap_transfers[0].amount, 7);
  assert.equal(original.deadCapAssignments[0].assigned_to_team_id, "third");
  assert.equal(original.proposeNote, "Version A");
  assert.equal(next.sourceReviewId, "review-1");
});

test("removing a cut releases its assignee without touching other terms", async () => {
  const { removeTradePackageLeg } = await import("./tradeBuilderHelpers.js");
  const original = { parties: [{ team_id: "mine", sends: [{ player_id: "a", to_team_id: "other" }], drops: ["b", "c"],
    dead_cap_transfers: [{ roster_slot_id: 1, amount: 7 }, { roster_slot_id: 2, amount: 3 }] }],
    deadCapAssignments: [{ player_id: "b", from_team_id: "mine", assigned_to_team_id: "other" }, { player_id: "c", from_team_id: "mine" }] };
  const removed = removeTradePackageLeg(original, { from: "mine", player_id: "b", drop: true });
  assert.deepEqual(removed.parties[0].drops, ["c"]);
  assert.deepEqual(removed.deadCapAssignments.map(a => a.player_id), ["c"]);
  assert.equal(removed.parties[0].sends.length, 1);
  const terms = removeTradePackageLeg(removed, { from: "mine", roster_slot_id: 1, deadCap: true });
  assert.deepEqual(terms.parties[0].dead_cap_transfers, [{ roster_slot_id: 2, amount: 3 }]);
  assert.equal(original.parties[0].dead_cap_transfers.length, 2);
});
