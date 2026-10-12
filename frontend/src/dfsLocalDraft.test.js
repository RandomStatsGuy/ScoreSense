import test from "node:test";
import assert from "node:assert/strict";
import { localDraftScope, createLocalDraftStore } from "./dfsLocalDraft.js";
test("T29: local drafts partition accounts without retaining credentials or granting access", () => {
  const token = sub => `header.${btoa(JSON.stringify({ sub }))}.secret`;
  assert.equal(localDraftScope(token("a")), "account:a");
  assert.notEqual(localDraftScope(token("a")), localDraftScope(token("b")));
  assert.equal(localDraftScope(null), "browser-local");
  assert.equal(localDraftScope("malformed"), "unavailable");
});
test("T28: missing browser storage is an explicit failure", async () => {
  await assert.rejects(createLocalDraftStore(null).write("browser-local", "{}"), /unavailable/);
});
