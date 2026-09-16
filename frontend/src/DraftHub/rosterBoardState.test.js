import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_ROSTER_STATE, normalizeRosterState, readRosterState, writeRosterState } from "./rosterBoardState.js";
const memory = () => { const data = new Map(); return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }; };
test("trade/history return restores filters, page, selection and panel state for only that league", () => {
  const storage = memory();
  const state = { ...DEFAULT_ROSTER_STATE, view: "teams", teamId: "manager-a", query: "Dalton", position: "TE", value: "above", sort: "name", page: 2, selectedKey: "manager-a:1", closed: true };
  writeRosterState("league-a", state, storage);
  assert.deepEqual(readRosterState("league-a", storage), state);
  assert.deepEqual(readRosterState("league-b", storage), DEFAULT_ROSTER_STATE);
});
test("invalid or blocked storage cannot break the board", () => {
  assert.deepEqual(normalizeRosterState({ view: "old", sort: "bad", page: -1, query: [], closed: "true" }), DEFAULT_ROSTER_STATE);
  assert.deepEqual(readRosterState("a", { getItem: () => "{" }), DEFAULT_ROSTER_STATE);
  const blocked = { getItem() { throw Error("blocked"); }, setItem() { throw Error("blocked"); } };
  assert.deepEqual(readRosterState("a", blocked), DEFAULT_ROSTER_STATE);
  assert.doesNotThrow(() => writeRosterState("a", DEFAULT_ROSTER_STATE, blocked));
});
