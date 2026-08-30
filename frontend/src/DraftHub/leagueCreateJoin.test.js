import test from "node:test";
import assert from "node:assert/strict";
import {
  FALLBACK_LEAGUE_PRESETS,
  leaguePresetOptions,
  parseLeagueTeamCount,
} from "./leagueCreateJoin.js";

test("empty or missing presets fall back to the default formats", () => {
  assert.deepEqual(leaguePresetOptions(undefined), FALLBACK_LEAGUE_PRESETS);
  assert.deepEqual(leaguePresetOptions(null), FALLBACK_LEAGUE_PRESETS);
  assert.deepEqual(leaguePresetOptions([]), FALLBACK_LEAGUE_PRESETS);
});

test("non-empty presets are used as-is", () => {
  const presets = [{ id: "snake_draft_v1", label: "Snake" }];
  assert.equal(leaguePresetOptions(presets), presets);
});

test("team count must be an integer from 2 to 20", () => {
  assert.deepEqual(parseLeagueTeamCount(12), { ok: true, count: 12 });
  assert.deepEqual(parseLeagueTeamCount("2"), { ok: true, count: 2 });
  assert.deepEqual(parseLeagueTeamCount("20"), { ok: true, count: 20 });
  assert.equal(parseLeagueTeamCount(1).ok, false);
  assert.equal(parseLeagueTeamCount(21).ok, false);
  assert.equal(parseLeagueTeamCount("").ok, false);
  assert.equal(parseLeagueTeamCount("abc").ok, false);
  assert.equal(parseLeagueTeamCount(2.5).ok, false);
  assert.match(parseLeagueTeamCount(1).error, /between 2 and 20/i);
});
