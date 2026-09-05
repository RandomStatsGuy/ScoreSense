import assert from "node:assert/strict";
import test from "node:test";
import {
  notifyPartnerNames,
  packageFingerprint,
  packageLegFlow,
  partnerCardMeta,
  sendGetCopy,
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
