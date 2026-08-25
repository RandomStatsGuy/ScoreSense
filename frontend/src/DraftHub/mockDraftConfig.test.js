import test from "node:test";
import assert from "node:assert/strict";
import {
  MOCK_DRAFT_STORAGE_KEY,
  botCountForTeams,
  buildMockDraftStartBody,
  mockDraftDisplayName,
  mockDraftFormatLabel,
  mockRoomPhaseLabel,
  readStoredMockLeagueId,
  writeStoredMockLeagueId,
} from "./mockDraftConfig.js";

test("botCountForTeams fills every seat except the user", () => {
  assert.equal(botCountForTeams(12), 11);
  assert.equal(botCountForTeams(8), 7);
  assert.equal(botCountForTeams(2), 1);
});

test("buildMockDraftStartBody uses preset when no league overlay", () => {
  const body = buildMockDraftStartBody({
    presetId: "snake_draft_v1",
    teamCount: 10,
    season: 2026,
  });
  assert.equal(body.mode, "quick_bots");
  assert.equal(body.team_count, 10);
  assert.equal(body.bot_count, 9);
  assert.equal(body.preset_id, "snake_draft_v1");
  assert.equal(body.source_league_id, undefined);
  assert.equal(body.auto_start, true);
});

test("buildMockDraftStartBody copies league rules or manager names", () => {
  const rules = buildMockDraftStartBody({
    presetId: "snake_draft_v1",
    sourceLeagueId: "lg-1",
    useLeagueRules: true,
  });
  assert.equal(rules.mode, "quick_bots");
  assert.equal(rules.source_league_id, "lg-1");
  assert.equal(rules.preset_id, undefined);

  const mirror = buildMockDraftStartBody({
    sourceLeagueId: "lg-1",
    useLeagueManagers: true,
  });
  assert.equal(mirror.mode, "league_mirror");
  assert.equal(mirror.source_league_id, "lg-1");
});

test("mock labels cover format and room phase", () => {
  assert.equal(mockDraftDisplayName({ presetId: "snake_draft_v1" }), "Snake mock draft");
  assert.equal(
    mockDraftDisplayName({ simulate: true, leagueName: "Dynasty" }),
    "Dynasty — simulated mock",
  );
  assert.equal(mockDraftFormatLabel("snake"), "Snake");
  assert.equal(mockRoomPhaseLabel({ status: "setup" }), "Ready");
  assert.equal(mockRoomPhaseLabel({ draft_completed: true }), "Completed");
  assert.equal(mockRoomPhaseLabel({ status: "nominating" }), "In progress");
});

test("session storage helpers round-trip a room id", () => {
  const mem = new Map();
  const storage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => { mem.set(k, String(v)); },
    removeItem: (k) => { mem.delete(k); },
  };
  writeStoredMockLeagueId("abc", storage);
  assert.equal(readStoredMockLeagueId(storage), "abc");
  assert.equal(mem.get(MOCK_DRAFT_STORAGE_KEY), "abc");
  writeStoredMockLeagueId("", storage);
  assert.equal(readStoredMockLeagueId(storage), "");
});
