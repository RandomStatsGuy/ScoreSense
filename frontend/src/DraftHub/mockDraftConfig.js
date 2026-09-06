/** Shared mock-draft launcher config (Tools → Mock draft). */

export const MOCK_DRAFT_STORAGE_KEY = "ss_mock_draft_league_id";

export const MOCK_DRAFT_PRESETS = [
  {
    id: "salary_cap_auction_v1",
    label: "Salary cap auction",
    hint: "Nominate players and bid against bots with a $200 cap.",
  },
  {
    id: "snake_draft_v1",
    label: "Snake draft",
    hint: "Classic snake — pick when the clock hits your seat. No bidding, no salary cap.",
  },
  {
    id: "linear_draft_v1",
    label: "Linear draft",
    hint: "Same pick order every round. No salary cap.",
  },
];

export const MOCK_TEAM_SIZES = [8, 10, 12];
export const RECENT_MOCKS_RAIL_LIMIT = 3;

export function mockDraftHeroCopy() {
  return {
    kicker: "Mock draft",
    heading: "Practice a draft that cannot touch keepers.",
    support: "Pick the format, invite friends, or run it against bots. This room does not write your real contracts.",
    formatTitle: "Choose the room",
    formatSupport: "Auction, snake, or linear. The wrong room writes the wrong recap.",
    fieldTitle: "Set the field",
    fieldSupport: "Set the size. Invite friends or leave the rest to bots.",
    matchTitle: "Match a real league",
    matchSupport: "Optional. Copy scoring and names, not keepers.",
    seatFact: (teams) => `${teams} seats · you draft from seat 1`,
    fieldLockedNote: (leagueName) => `Field size follows ${leagueName || "your league"}.`,
    modeTogetherSub: "Share a link",
    modeLiveSub: (bots) => `You vs ${bots} bots`,
    modeSimSub: "Skip to the results",
    recentTitle: "Recent mocks",
    recentEmpty: "No mocks yet",
    recentMore: "All practice rooms",
  };
}

export function mockDraftFormatNote(presetId) {
  if (presetId === "snake_draft_v1") return "Plan the turns. Let the board come to you.";
  if (presetId === "linear_draft_v1") return "Same seat every round. Make position count.";
  return "Nominate and bid. Overspend and you miss later names.";
}

/** League overlay locks field size to that league, even when it is not 8 / 10 / 12. */
export function resolveMockTeamCount({
  teamCount = 12,
  leagueTeamCount = null,
  followLeague = false,
} = {}) {
  if (followLeague) {
    const n = Number(leagueTeamCount);
    if (Number.isFinite(n) && n >= 2 && n <= 24) return n;
  }
  const n = Number(teamCount);
  return MOCK_TEAM_SIZES.includes(n) ? n : 12;
}

export function mockTeamSizeOptions(leagueTeamCount, followLeague = false) {
  const locked = followLeague ? Number(leagueTeamCount) : NaN;
  if (Number.isFinite(locked) && locked >= 2 && locked <= 24 && !MOCK_TEAM_SIZES.includes(locked)) {
    return [...MOCK_TEAM_SIZES, locked].sort((a, b) => a - b);
  }
  return MOCK_TEAM_SIZES;
}

export function recentMocksForRail(rooms, limit = RECENT_MOCKS_RAIL_LIMIT) {
  return (Array.isArray(rooms) ? rooms : []).slice(0, Math.max(0, limit));
}

export function formatMockRoomWhen(value, now = Date.now()) {
  if (value == null || value === "") return "";
  const ms = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(ms)) return "";
  const diffSec = Math.round((now - ms) / 1000);
  if (diffSec < 60) return "Just now";
  if (diffSec < 3600) return `${Math.max(1, Math.round(diffSec / 60))}m ago`;
  if (diffSec < 172800) return `${Math.max(1, Math.round(diffSec / 3600))}h ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function botCountForTeams(teamCount) {
  const n = Math.max(2, Math.min(Number(teamCount) || 12, 24));
  return n - 1;
}

/** First finite season from app meta, hub context, or an explicit number. */
export function resolveMockDraftSeason(...sources) {
  for (const source of sources) {
    if (source == null || source === "") continue;
    if (typeof source === "object") {
      const nested = resolveMockDraftSeason(source.default_season, source.season);
      if (nested != null) return nested;
      continue;
    }
    const n = Number(source);
    if (Number.isFinite(n) && n >= 1999) return n;
  }
  return null;
}

function presetById(presetId) {
  return MOCK_DRAFT_PRESETS.find((p) => p.id === presetId) || MOCK_DRAFT_PRESETS[0];
}

export function buildMockDraftStartBody({
  presetId = "salary_cap_auction_v1",
  teamCount = 12,
  leagueTeamCount = null,
  season,
  sourceLeagueId = null,
  useLeagueRules = false,
  useLeagueManagers = false,
  name = null,
  lobby = false,
} = {}) {
  const followLeague = Boolean(sourceLeagueId && (useLeagueRules || useLeagueManagers));
  const teams = resolveMockTeamCount({
    teamCount,
    leagueTeamCount,
    followLeague,
  });
  const hasSource = Boolean(sourceLeagueId);
  const mode = useLeagueManagers && hasSource ? "league_mirror" : "quick_bots";
  const resolvedSeason = resolveMockDraftSeason(season);
  const together = Boolean(lobby);
  const body = {
    mode,
    season: resolvedSeason ?? 2026,
    team_count: teams,
    bot_count: together ? 0 : botCountForTeams(teams),
    auto_start: !together,
    lobby: together,
  };
  if (name) body.name = name;
  if (mode === "league_mirror" || (useLeagueRules && hasSource)) {
    body.source_league_id = sourceLeagueId;
  } else {
    body.preset_id = presetId || "salary_cap_auction_v1";
  }
  return body;
}

export function mockDraftDisplayName({
  presetId = "salary_cap_auction_v1",
  simulate = false,
  useLeagueManagers = false,
  leagueName = "",
} = {}) {
  if (simulate) {
    return leagueName ? `${leagueName} — simulated mock` : "Simulated mock draft";
  }
  if (useLeagueManagers && leagueName) return `${leagueName} — mock draft`;
  if (presetId === "snake_draft_v1") return "Snake mock draft";
  if (presetId === "linear_draft_v1") return "Linear mock draft";
  return "Quick mock draft";
}

export function mockRoomPhaseLabel(room) {
  if (!room) return "";
  if (room.draft_completed || room.status === "completed") return "Completed";
  const status = String(room.status || "setup").toLowerCase();
  if (status === "setup") return "Lobby";
  return "In progress";
}

export function mockRoomPhaseKey(room) {
  const label = mockRoomPhaseLabel(room);
  if (label === "Completed") return "completed";
  if (label === "Ready" || label === "Lobby") return "ready";
  return "live";
}

export function mockRoomResumeLabel(room) {
  const phase = mockRoomPhaseKey(room);
  if (phase === "completed") return "View recap";
  if (phase === "ready") return "Open lobby";
  return "Resume";
}

export function mockDraftFormatLabel(draftType) {
  const t = String(draftType || "auction").toLowerCase();
  if (t === "snake") return "Snake";
  if (t === "linear") return "Linear";
  return "Auction";
}

export function mockDraftLaunchSummary({
  presetId = "salary_cap_auction_v1",
  teamCount = 12,
  leagueTeamCount = null,
  season = null,
  useLeagueRules = false,
  useLeagueManagers = false,
  hasLeague = false,
  leagueName = "",
} = {}) {
  const preset = presetById(presetId);
  const followLeague = Boolean(hasLeague && (useLeagueRules || useLeagueManagers));
  const teams = resolveMockTeamCount({ teamCount, leagueTeamCount, followLeague });
  const league = String(leagueName || "").trim() || "your league";
  const copiesLeagueRules = Boolean(hasLeague && (useLeagueRules || useLeagueManagers));
  const resolvedSeason = resolveMockDraftSeason(season);
  return {
    format: preset.label,
    teams,
    bots: botCountForTeams(teams),
    you: 1,
    season: resolvedSeason,
    ruleSource: copiesLeagueRules ? `${league} rules` : `${preset.label} preset`,
    managerSource: hasLeague && useLeagueManagers ? `${league} managers` : "Generic bots",
  };
}

export function readStoredMockLeagueId(storage) {
  if (storage) {
    try {
      return storage.getItem(MOCK_DRAFT_STORAGE_KEY) || "";
    } catch {
      return "";
    }
  }
  try {
    const session = typeof sessionStorage === "undefined"
      ? ""
      : (sessionStorage.getItem(MOCK_DRAFT_STORAGE_KEY) || "");
    if (session) return session;
    return typeof localStorage === "undefined"
      ? ""
      : (localStorage.getItem(MOCK_DRAFT_STORAGE_KEY) || "");
  } catch {
    return "";
  }
}

export function writeStoredMockLeagueId(leagueId, storage) {
  const value = leagueId ? String(leagueId) : "";
  const apply = (store) => {
    if (!store) return;
    try {
      if (!value) store.removeItem(MOCK_DRAFT_STORAGE_KEY);
      else store.setItem(MOCK_DRAFT_STORAGE_KEY, value);
    } catch {
      /* ignore quota / private mode */
    }
  };
  if (storage) {
    apply(storage);
    return;
  }
  apply(typeof sessionStorage === "undefined" ? null : sessionStorage);
  apply(typeof localStorage === "undefined" ? null : localStorage);
}
