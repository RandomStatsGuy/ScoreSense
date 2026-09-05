import assert from "node:assert/strict";
import test from "node:test";
import { buildPendingRosterWrites, buildRosterWriteRequest, sendRosterWrite } from "./rosterWrite.js";

test("type plus salary is one PATCH, not a second contract-type POST", () => {
  const req = buildRosterWriteRequest({
    playerId: "00-0035676",
    contractType: "Rookie",
    salary: 12,
    years: 2,
    note: "Keeper reset",
  });
  assert.equal(req.path, "/api/hub/roster");
  assert.equal(req.method, "PATCH");
  assert.deepEqual(req.body, {
    player_id: "00-0035676",
    contract_type: "rookie",
    salary: 12,
    contract_years: 2,
    note: "Keeper reset",
  });
});

test("drop is one DELETE", () => {
  const req = buildRosterWriteRequest({ playerId: "p1", drop: true, contractType: "veteran" });
  assert.equal(req.method, "DELETE");
  assert.deepEqual(req.body, { player_id: "p1" });
});

test("pending tray emits one write per player", () => {
  const writes = buildPendingRosterWrites({
    a: { contractType: "extension", salary: 20, years: 3 },
    b: { drop: true },
  }, { note: "Office tray" });
  assert.equal(writes.length, 2);
  assert.equal(writes[0].method, "PATCH");
  assert.equal(writes[0].body.contract_type, "extension");
  assert.equal(writes[0].body.salary, 20);
  assert.equal(writes[0].body.note, "Office tray");
  assert.equal(writes[1].method, "DELETE");
  assert.ok(writes.every((w) => w.path === "/api/hub/roster"));
});

test("sendRosterWrite posts one PATCH for a combined change", async () => {
  const calls = [];
  await sendRosterWrite(async (path, opts) => {
    calls.push({ path, ...opts, body: JSON.parse(opts.body) });
    return { ok: true };
  }, { playerId: "p1", contractType: "veteran", salary: 9 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/api/hub/roster");
  assert.equal(calls[0].method, "PATCH");
  assert.equal(calls[0].body.contract_type, "veteran");
  assert.equal(calls[0].body.salary, 9);
});
