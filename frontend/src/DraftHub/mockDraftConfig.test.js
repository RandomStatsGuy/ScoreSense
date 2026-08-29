import test from "node:test";
import assert from "node:assert/strict";
import {
  MOCK_DRAFT_PRESETS,
  MOCK_DRAFT_STORAGE_KEY,
  botCountForTeams,
  buildMockDraftStartBody,
  mockDraftDisplayName,
  mockDraftFormatLabel,
  mockDraftLaunchSummary,
  mockRoomPhaseKey,
  mockRoomPhaseLabel,
  mockRoomResumeLabel,
  readStoredMockLeagueId,
  resolveMockDraftSeason,
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
  assert.equal(body.lobby, false);
  assert.equal(body.season, 2026);
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

test("buildMockDraftStartBody opens a lobby without auto-start", () => {
  const body = buildMockDraftStartBody({
    presetId: "snake_draft_v1",
    teamCount: 10,
    lobby: true,
  });
  assert.equal(body.lobby, true);
  assert.equal(body.auto_start, false);
  assert.equal(body.bot_count, 0);
});

test("mock labels cover format and room phase", () => {
  assert.equal(mockDraftDisplayName({ presetId: "snake_draft_v1" }), "Snake mock draft");
  assert.equal(
    mockDraftDisplayName({ simulate: true, leagueName: "Dynasty" }),
    "Dynasty — simulated mock",
  );
  assert.equal(mockDraftFormatLabel("snake"), "Snake");
  assert.match(
    MOCK_DRAFT_PRESETS.find((p) => p.id === "snake_draft_v1").hint,
    /no salary cap/i,
  );
  assert.equal(mockRoomPhaseLabel({ status: "setup" }), "Lobby");
  assert.equal(mockRoomResumeLabel({ status: "setup" }), "Open lobby");
  assert.equal(mockRoomPhaseLabel({ draft_completed: true }), "Completed");
  assert.equal(mockRoomPhaseLabel({ status: "completed" }), "Completed");
  assert.equal(mockRoomPhaseLabel({ status: "nominating" }), "In progress");
  assert.equal(mockRoomPhaseKey({ status: "completed" }), "completed");
  assert.equal(mockRoomPhaseKey({ draft_completed: true }), "completed");
  assert.equal(mockRoomResumeLabel({ status: "completed" }), "View recap");
  assert.equal(mockRoomResumeLabel({ status: "picking" }), "Resume");
});

test("resolveMockDraftSeason prefers application defaults over a hard-coded year", () => {
  assert.equal(resolveMockDraftSeason({ default_season: 2025 }, { season: 2024 }), 2025);
  assert.equal(resolveMockDraftSeason(null, { season: 2024 }), 2024);
  assert.equal(resolveMockDraftSeason(undefined, undefined), null);
});

test("launch summary keeps rules and manager names on separate fields", () => {
  const preset = mockDraftLaunchSummary({
    presetId: "snake_draft_v1",
    teamCount: 10,
    season: 2026,
  });
  assert.equal(preset.format, "Snake draft");
  assert.equal(preset.teams, 10);
  assert.equal(preset.bots, 9);
  assert.equal(preset.season, 2026);
  assert.equal(preset.ruleSource, "Snake draft preset");
  assert.equal(preset.managerSource, "Generic bots");

  const mixed = mockDraftLaunchSummary({
    presetId: "snake_draft_v1",
    teamCount: 10,
    season: { default_season: 2026 },
    hasLeague: true,
    leagueName: "WCC",
    useLeagueRules: false,
    useLeagueManagers: true,
  });
  assert.match(mixed.ruleSource, /WCC rules/);
  assert.match(mixed.managerSource, /WCC managers/);
  assert.doesNotMatch(mixed.managerSource, /rules/i);

  const rulesOnly = mockDraftLaunchSummary({
    presetId: "linear_draft_v1",
    hasLeague: true,
    leagueName: "WCC",
    useLeagueRules: true,
    useLeagueManagers: false,
  });
  assert.match(rulesOnly.ruleSource, /WCC rules/);
  assert.equal(rulesOnly.managerSource, "Generic bots");
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
