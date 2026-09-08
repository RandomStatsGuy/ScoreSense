import assert from "node:assert/strict";
import test from "node:test";
import {
  canRunOfflineCommissioner,
  canShowOwnerRecord,
  isOfflineConduct,
  startDraftSearch,
} from "./offlineDraft.js";

test("offline start query skips force unless asked and sets conduct", () => {
  assert.equal(startDraftSearch({ conduct: "offline" }), "?conduct=offline");
  assert.equal(
    startDraftSearch({ force: true, fillBots: true, conduct: "offline" }),
    "?force=true&fill_bots=true&conduct=offline",
  );
  assert.equal(startDraftSearch({}), "");
  assert.equal(isOfflineConduct({ conduct: "offline" }), true);
  assert.equal(isOfflineConduct({ conduct: "live" }), false);
  assert.equal(isOfflineConduct(null), false);
});

test("owner record follows the window, not Free agents Add", () => {
  assert.equal(canShowOwnerRecord({ myTeamId: "t1", session: { owner_entry_open: true } }), true);
  assert.equal(canShowOwnerRecord({
    myTeamId: "t1",
    hubContext: { acquisition_window: { can_record_draft_result: true } },
  }), true);
  assert.equal(canShowOwnerRecord({ myTeamId: "t1", session: {} }), false);
  assert.equal(canShowOwnerRecord({ session: { owner_entry_open: true } }), false);
});

test("offline commissioner tools stay on the primary seat", () => {
  assert.equal(canRunOfflineCommissioner({
    hubContext: { is_primary_commissioner: true },
    isCommissioner: true,
  }), true);
  assert.equal(canRunOfflineCommissioner({
    hubContext: { is_primary_commissioner: false },
    isCommissioner: true,
  }), false);
  assert.equal(canRunOfflineCommissioner({ isCommissioner: true }), true);
});
