import assert from "node:assert/strict";
import test from "node:test";
import { resolveTradePartnerId } from "./tradeSeed.js";

test("trade seed ignores a partner that is the viewer", () => {
  assert.equal(resolveTradePartnerId({ partnerTeamId: "me" }, "me"), "");
  assert.equal(resolveTradePartnerId({ partnerTeamId: "them" }, "me"), "them");
  assert.equal(
    resolveTradePartnerId({
      partnerTeamId: "me",
      players: [{ team_id: "them", player_id: "p1" }],
    }, "me"),
    "them",
  );
  assert.equal(
    resolveTradePartnerId({}, "me", [{ team: { id: "me" } }, { team: { id: "them" } }]),
    "them",
  );
});
