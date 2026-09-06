/** Command-board layout for Fantasy → This Week. */

import { leagueBoardEmpty } from "./leagueBoardEmpty.js";

export const DEFAULT_STARTER_COUNTS = {
  QB: 1,
  RB: 2,
  WR: 2,
  TE: 1,
  FLEX: 1,
  K: 1,
  DEF: 1,
};

export const BOARD_SLOT_ORDER = ["QB", "RB", "WR", "TE", "FLEX", "K", "DEF"];

export const WEEK_BOARD_COPY = {
  seeCalls: "See lineup calls",
  emptySlot: (slot) => `Find ${slot}`,
  emptySlotName: "Empty",
  lineupSource: "Lineup calls use the board number. Vibes only scale VA-projections.",
  ptsUnit: "wk",
  emptySlotHint: "Open Free agents",
  noProjection: "No projection",
  startFallback: "Start bench",
  startInSleeper: "Opens Sleeper to set this start.",
  startExternal: "Set this start in your league app.",
  lineupLocked: "Lineup is locked.",
  refreshProjections: "Refresh projections",
  refreshing: "Refreshing…",
  rosterFresh: "Roster",
  weekBoardFresh: "Week board",
  legendSwap: "Swap recommended",
  legendWide: "Wide range",
  legendNote: "Amber is a start/sit call. A wide range is a quiet floor–ceiling mark, not a flag.",
  railByeHint: "Sit them before lock.",
  railByeEmpty: "Nobody on bye.",
  railInjuredHint: "Do not leave an out player in.",
  railInjuredEmpty: "Nobody flagged out.",
  railWideHint: "Floor to ceiling is large — not a start/sit call.",
  railWideEmpty: "No unusually wide ranges.",
  openGameCenter: "Open Game center",
  gameCenterSupport: "Live scoring, the scoreboard, and week trophies.",
  vibeNote: "Vibes uses an aura-adjusted week. The number here is the model.",
  vibePts: "Vibes",
  findSpecialists: "Empty K or DEF — Cap already knows. Find them on Free agents.",
  weekLabel: "Week",
  callKicker: (slot) => (slot ? `Lineup call · ${slot}` : "Lineup call"),
  sitRole: "Sit",
  startRole: "Start",
  weekPts: "Week pts",
  vegas: "Vegas",
  priorPpg: (season) => (season != null ? `${season} PPG` : "Prior PPG"),
  defVs: (pos) => (pos ? `Def vs ${pos}` : "Def vs pos"),
  kickoff: "Kickoff",
  emptyFact: "—",
  closeCall: "Close",
  keepFallback: "Keep starter",
  week1PpgNote: "Week 1 uses last season’s PPG. A rookie stays empty.",
  laterPpgNote: "Last season’s PPG. A rookie stays empty.",
  specialistEmpty: "Specialist",
};

export const WEEK_BOUNDS = { min: 1, max: 22 };
export const ROSTER_STALE_HOURS = 48;
export const VIBE_DELTA_FLOOR = 0.45;
export const FLEX_ELIGIBLE = ["RB", "WR", "TE"];

export function starterSlotLabel(position, index, count) {
  if (count <= 1) return position;
  return `${position}${index + 1}`;
}

function starterCount(roster, position, missing = 0) {
  const entry = roster?.[position.toLowerCase()];
  if (!entry || typeof entry !== "object") return missing;
  const n = Number(entry.starter);
  return Number.isFinite(n) ? Math.max(0, n) : missing;
}

export function buildStarterSlotPlan(rules) {
  const roster = rules?.roster;
  const hasRoster = Boolean(roster && Object.keys(roster).length);
  const counts = { ...DEFAULT_STARTER_COUNTS };

  if (hasRoster) {
    for (const pos of ["QB", "RB", "WR", "TE", "K", "DEF"]) {
      counts[pos] = starterCount(roster, pos, 0);
    }
    counts.FLEX = roster.flex && typeof roster.flex === "object"
      ? Math.max(0, Number(roster.flex.starter) || 0)
      : 0;
  }

  const slots = [];
  for (const pos of BOARD_SLOT_ORDER) {
    const n = counts[pos] || 0;
    for (let i = 0; i < n; i += 1) {
      const slot = starterSlotLabel(pos, i, n);
      slots.push({
        key: slot,
        slot,
        position: pos,
        index: i,
      });
    }
  }
  return slots;
}

function posOf(player) {
  return String(player?.position || "").toUpperCase();
}

export function fillStarterSlots(plan = [], starters = []) {
  const remaining = [...starters];
  const used = new Set();

  const take = (pred) => {
    const hit = remaining.find((player) => (
      Boolean(player?.player_id) && !used.has(player.player_id) && pred(player)
    ));
    if (!hit) return null;
    used.add(hit.player_id);
    return hit;
  };

  return plan.map((slot) => {
    const bySlot = take((player) => player.slot === slot.slot);
    if (bySlot) return { ...slot, player: bySlot };

    const byPos = take((player) => {
      if (slot.position === "FLEX") {
        return String(player.slot || "").startsWith("FLEX")
          || (posOf(player) && FLEX_ELIGIBLE.includes(posOf(player))
            && String(player.lineup_role) === "starter");
      }
      return posOf(player) === slot.position;
    });
    return { ...slot, player: byPos };
  });
}

export function indexByPlayerId(rows = []) {
  const map = new Map();
  for (const row of rows) {
    const id = String(row?.player_id || "");
    if (id) map.set(id, row);
  }
  return map;
}

export function decisionForStarter(slot, decisions = []) {
  const pid = slot?.player?.player_id;
  return decisions.find((decision) => (
    (pid && String(decision?.starter_player_id || "") === String(pid))
    || (decision?.starter_slot && decision.starter_slot === slot?.slot)
  )) || null;
}

export function slotTone(slot, { decision, wide, injured, onBye } = {}) {
  if (!slot?.player) return "empty";
  if (decision) return "swap";
  if (injured) return "injured";
  if (onBye) return "bye";
  if (wide) return "wide";
  return "set";
}

export function formatDraftNightShort(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const weekday = d.toLocaleDateString(undefined, { weekday: "short" });
  const hour = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const compact = hour.replace(":00", "").replace(/\s*AM/i, " a.m.").replace(/\s*PM/i, " p.m.");
  return `${weekday} ${compact}`;
}

export function weekHeroCopy({
  loading = false,
  error = false,
  loadFailed = false,
  emptyRoster = false,
  unlinked = false,
  draftCompleted = false,
  poorCoverage = false,
  decisionCount = 0,
  weekLabel = "This week",
  draftNightLabel = "",
} = {}) {
  const failed = loadFailed || error;
  if (loading) {
    return {
      heading: "Reading your lineup…",
      support: "Cap and projections are still landing.",
      chip: weekLabel || "This week",
      chipTone: "readonly",
    };
  }
  if (failed) {
    return {
      heading: "Lineup did not load. Retry.",
      support: "Server did not respond — Retry",
      chip: weekLabel || "This week",
      chipTone: "caution",
    };
  }
  if (emptyRoster && !draftCompleted) {
    const night = draftNightLabel ? ` Draft night is ${draftNightLabel}.` : "";
    return {
      heading: `Lineups open after the draft.${night}`,
      support: "A start now would be a guess. Lock a night so seats fill.",
      chip: weekLabel || "Waiting on roster",
      chipTone: "readonly",
    };
  }
  if (emptyRoster) {
    const empty = leagueBoardEmpty({
      emptyRoster: true,
      sleeperLinked: !unlinked,
      draftCompleted,
    });
    return {
      heading: empty?.heading || "Need a roster to set a lineup.",
      support: empty?.support || "Lock a night so seats fill. Empty seats draft as bots.",
      chip: weekLabel || "Waiting on roster",
      chipTone: "readonly",
    };
  }
  if (poorCoverage) {
    return {
      heading: "Cannot trust a swap yet.",
      support: "The roster still shows. Sit/start calls wait until projections cover the week.",
      chip: weekLabel,
      chipTone: "readonly",
    };
  }
  if (decisionCount > 0) {
    return {
      heading: decisionCount === 1
        ? "One lineup call on the board."
        : `${decisionCount} lineup calls on the board.`,
      support: "A flagged bench player outprojects the starter. Sit the wrong one and you leave those points.",
      chip: weekLabel,
      chipTone: "active",
    };
  }
  return {
    heading: "No swap worth making.",
    support: "Bye and injury still sit people. Check those before lock.",
    chip: weekLabel,
    chipTone: "active",
  };
}

function railCountItem(id, label, count, { hint, emptyHint, toneWhenOn } = {}) {
  const n = Number(count) || 0;
  const on = n > 0;
  return {
    id,
    label,
    value: String(n),
    hint: on ? hint : emptyHint,
    tone: on ? toneWhenOn : "quiet",
    muted: !on,
    href: on ? "#hub-wcc-calls" : undefined,
  };
}

export function weekRailItems({
  loading = false,
  error = false,
  loadFailed = false,
  emptyRoster = false,
  unlinked = false,
  poorCoverage = false,
  counts = {},
} = {}) {
  if (loadFailed || error) {
    return [
      { id: "board", label: "Board", value: "Did not load", tone: "warn" },
      { id: "next", label: "Next", value: "Retry" },
    ];
  }
  if (loading) {
    return [
      { id: "board", label: "Board", value: "Reading" },
      { id: "next", label: "Next", value: "—" },
    ];
  }
  if (emptyRoster) {
    return [
      { id: "board", label: "Board", value: "Empty", tone: "warn" },
      { id: "next", label: "Next", value: "Waiting on roster" },
    ];
  }
  if (poorCoverage) {
    return [
      { id: "board", label: "Board", value: "Coverage thin", tone: "warn" },
      { id: "next", label: "Next", value: "Refresh week board" },
    ];
  }
  return [
    railCountItem("bye", "On bye", counts.on_bye, {
      hint: WEEK_BOARD_COPY.railByeHint,
      emptyHint: WEEK_BOARD_COPY.railByeEmpty,
      toneWhenOn: "warn",
    }),
    railCountItem("injured", "Injured", counts.injured, {
      hint: WEEK_BOARD_COPY.railInjuredHint,
      emptyHint: WEEK_BOARD_COPY.railInjuredEmpty,
      toneWhenOn: "warn",
    }),
    railCountItem("ranges", "Wide ranges", counts.wide_ranges, {
      hint: WEEK_BOARD_COPY.railWideHint,
      emptyHint: WEEK_BOARD_COPY.railWideEmpty,
      toneWhenOn: "quiet",
    }),
  ];
}

export function weekRailNote({
  loadFailed = false,
  emptyRoster = false,
  unlinked = false,
  draftCompleted = false,
  poorCoverage = false,
  headline = "",
  syncedLabel = "",
} = {}) {
  if (loadFailed) return "Server did not respond — Retry";
  if (emptyRoster) {
    const empty = leagueBoardEmpty({
      emptyRoster: true,
      sleeperLinked: !unlinked,
      draftCompleted,
    });
    return empty?.note || "Lock a night on Draft. Empty seats draft as bots.";
  }
  if (unlinked) return "Sleeper is not linked. The board is using league contracts.";
  if (poorCoverage) return "Waiting on projection coverage before lineup advice is useful.";
  return WEEK_BOARD_COPY.legendNote;
}

export function weekPrimaryAction({
  loading = false,
  error = false,
  loadFailed = false,
  emptyRoster = false,
  unlinked = false,
  canSync = false,
  draftCompleted = false,
  sleeperStale = false,
  showGameCenter = false,
} = {}) {
  if (loadFailed || error) return { kind: "retry", label: "Retry" };
  if (loading) return { kind: "wait", label: "Reading…" };
  if (emptyRoster) {
    const empty = leagueBoardEmpty({
      emptyRoster: true,
      sleeperLinked: !unlinked,
      draftCompleted,
      sleeperStale: sleeperStale || canSync,
    });
    return empty?.action || { kind: "room", label: "Lock a night" };
  }
  if (showGameCenter) {
    return { kind: "game", label: WEEK_BOARD_COPY.openGameCenter };
  }
  return { kind: "none", label: "" };
}

export function weekBoardOverlayCopy({
  loadFailed = false,
  loading = false,
  emptyRoster = false,
  unlinked = false,
} = {}) {
  if (loadFailed) {
    return {
      title: "Lineup did not load.",
      body: "Server did not respond — Retry",
    };
  }
  if (loading && !emptyRoster && !unlinked) {
    return {
      title: "Reading your lineup…",
      body: "Cap and projections are still landing.",
    };
  }
  return {
    title: "Your roster isn't here yet.",
    body: unlinked
      ? "Link Sleeper from Roster management, then sync to fill these slots."
      : "Sync league to fill these slots.",
  };
}

export function trophyStripCopy({ boardReady = true, loading = false } = {}) {
  if (loading) return "Loading league trophies…";
  if (!boardReady) return "Voting after the board is live.";
  return "One vote per trophy. Reactions unlock after you win the matchup.";
}

export function boardTitle(weekLabel) {
  return weekLabel ? `${weekLabel} board` : "This week board";
}

export function swapBenchIdSet(decisions = []) {
  return new Set(
    decisions
      .map((decision) => decision?.bench_player_id)
      .filter((id) => id != null && String(id) !== "")
      .map(String),
  );
}

export function canEditHubLineup({
  mode,
  lineupSource,
  lineupLocked,
} = {}) {
  return mode === "league" && lineupSource === "hub" && !lineupLocked;
}

export function decisionSwapIds(decision) {
  const starter = String(decision?.starter_player_id || "");
  const bench = String(decision?.bench_player_id || "");
  if (!starter || !bench) return null;
  return { starter_player_id: starter, bench_player_id: bench };
}

const NAME_SUFFIXES = new Set(["jr", "jr.", "sr", "sr.", "ii", "iii", "iv", "v"]);
const NAME_PARTICLES = new Set(["st", "st.", "van", "de", "del", "da", "la", "le"]);

export function startSurname(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  let end = parts.length - 1;
  while (end > 0 && NAME_SUFFIXES.has(parts[end].toLowerCase())) end -= 1;
  const last = parts[end];
  const prev = end > 0 ? parts[end - 1] : "";
  if (prev && NAME_PARTICLES.has(prev.toLowerCase())) return `${prev} ${last}`;
  return last;
}

export function startCallLabel(decision) {
  const surname = startSurname(decision?.bench_player_name);
  return surname ? `Start ${surname}` : WEEK_BOARD_COPY.startFallback;
}

export function keepCallLabel(decision) {
  const surname = startSurname(decision?.starter_player_name);
  return surname ? `Keep ${surname}` : WEEK_BOARD_COPY.keepFallback;
}

export function callTitle(decision) {
  const sit = startSurname(decision?.starter_player_name);
  const go = startSurname(decision?.bench_player_name);
  if (sit && go) return `Sit ${sit}. Start ${go}.`;
  if (go) return `Start ${go}.`;
  return WEEK_BOARD_COPY.callKicker(decision?.starter_slot);
}

export function priorPpgSeason(season) {
  const year = Number(season);
  return Number.isFinite(year) ? year - 1 : null;
}

export function callPpgNote(week) {
  return Number(week) === 1 ? WEEK_BOARD_COPY.week1PpgNote : WEEK_BOARD_COPY.laterPpgNote;
}

export function ordinalRank(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "";
  const rounded = Math.round(n);
  const mod100 = rounded % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${rounded}th`;
  const suffix = { 1: "st", 2: "nd", 3: "rd" }[rounded % 10] || "th";
  return `${rounded}${suffix}`;
}

function finiteNumber(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function formatVegasFact(player) {
  const spread = finiteNumber(player?.vegas_spread);
  const total = finiteNumber(player?.vegas_total);
  const bits = [];
  if (spread != null) bits.push(spread > 0 ? `+${spread}` : String(spread));
  if (total != null) bits.push(`O/U ${total}`);
  return bits.join(" · ") || WEEK_BOARD_COPY.emptyFact;
}

export function formatKickoffFact(player) {
  const iso = player?.kickoff_et;
  if (iso) {
    const date = new Date(iso);
    if (!Number.isNaN(date.getTime())) {
      const day = date.toLocaleDateString("en-US", {
        weekday: "short",
        timeZone: "America/New_York",
      });
      const time = date.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        timeZone: "America/New_York",
      });
      const compact = time.replace(/\s*[AP]M/i, "").trim();
      return `${day} ${compact}`;
    }
  }
  const weekday = String(player?.weekday || "").trim();
  return weekday ? weekday.slice(0, 3) : WEEK_BOARD_COPY.emptyFact;
}

export function formatPriorPpgFact(player) {
  const ppg = finiteNumber(player?.prior_ppg);
  if (ppg == null) return WEEK_BOARD_COPY.emptyFact;
  return ppg.toFixed(1);
}

export function formatDefVsFact(player) {
  const opp = String(player?.opponent || "").replace(/^@/, "").replace(/^BYE$/i, "").trim();
  const rank = ordinalRank(player?.opp_def_rank);
  const ppg = finiteNumber(player?.opp_def_ppg);
  const head = [opp && opp.toUpperCase() !== "BYE" ? opp : "", rank].filter(Boolean).join(" ");
  const bits = [];
  if (head) bits.push(head);
  if (ppg != null) bits.push(ppg.toFixed(1));
  return bits.join(" · ") || WEEK_BOARD_COPY.emptyFact;
}

export function callFaceMeta(player) {
  const team = String(player?.team || "").trim();
  if (player?.on_bye) return [team, "Bye"].filter(Boolean).join(" · ");
  const opp = String(player?.opponent || "").replace(/^@/, "").trim();
  let site = "";
  if (player?.is_home === true && opp) site = `Home vs ${opp}`;
  else if (player?.is_home === false && opp) site = `Away @ ${opp}`;
  else if (opp) site = String(player?.opponent || "").startsWith("@") ? `Away @ ${opp}` : `vs ${opp}`;
  return [team, site].filter(Boolean).join(" · ");
}

export function slatePlayerMeta(player) {
  const bits = [player?.position, player?.team].filter(Boolean);
  if (player?.on_bye) bits.push("BYE");
  else if (player?.opponent) {
    const opp = String(player.opponent).replace(/^@/, "").trim();
    if (opp) bits.push(String(player.opponent).startsWith("@") ? `@ ${opp}` : `vs ${opp}`);
  }
  return bits.join(" · ");
}

export function playerById(rows = [], playerId) {
  const id = String(playerId || "");
  if (!id) return null;
  return (rows || []).find((row) => String(row?.player_id || "") === id) || null;
}

export function callSheetPlayers(decision, starters = [], bench = []) {
  const pool = [...(starters || []), ...(bench || [])];
  return {
    starter: playerById(pool, decision?.starter_player_id),
    bench: playerById(pool, decision?.bench_player_id),
  };
}

export function sleeperLineupUrl(sleeperLeagueId) {
  const id = String(sleeperLeagueId || "").trim();
  if (!id) return "";
  return `https://sleeper.com/leagues/${encodeURIComponent(id)}`;
}

export function lineupCallAction({
  canEdit = false,
  lineupLocked = false,
  sleeperLeagueId = "",
} = {}) {
  if (canEdit) return { kind: "apply" };
  if (lineupLocked) return { kind: "locked", reason: WEEK_BOARD_COPY.lineupLocked };
  const href = sleeperLineupUrl(sleeperLeagueId);
  if (href) return { kind: "sleeper", href, reason: WEEK_BOARD_COPY.startInSleeper };
  return { kind: "external", reason: WEEK_BOARD_COPY.startExternal };
}

export function stripUpdatedPrefix(label) {
  return String(label || "").replace(/^Updated\s+/i, "").trim();
}

export function relativeAgeHours(value, now = Date.now()) {
  if (value == null || value === "") return null;
  const ms = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, (Number(now) - ms) / 3600000);
}

export function boardFreshnessLine({
  rosterAt,
  weekBoardAt,
  rosterLabel,
  weekLabel,
  now = Date.now(),
} = {}) {
  const rosterAge = stripUpdatedPrefix(rosterLabel);
  const weekAge = stripUpdatedPrefix(weekLabel);
  const hours = relativeAgeHours(rosterAt, now);
  return {
    roster: rosterAge ? `${WEEK_BOARD_COPY.rosterFresh} ${rosterAge}` : "",
    weekBoard: weekAge ? `${WEEK_BOARD_COPY.weekBoardFresh} ${weekAge}` : "",
    rosterStale: hours != null && hours >= ROSTER_STALE_HOURS,
    weekAt: weekBoardAt || null,
  };
}

export function clampWeek(value, fallback = 1) {
  const n = Number(value);
  const base = Number.isFinite(n) ? n : Number(fallback) || WEEK_BOUNDS.min;
  return Math.min(WEEK_BOUNDS.max, Math.max(WEEK_BOUNDS.min, Math.round(base)));
}

export function weekSelectOptions(current) {
  const max = Math.max(WEEK_BOUNDS.max, clampWeek(current, 1));
  return Array.from({ length: max }, (_, i) => i + 1);
}

export function emptySpecialistSlots(slots = []) {
  return (slots || []).filter((slot) => (
    !slot?.player && (slot?.position === "K" || slot?.position === "DEF")
  ));
}

export function projectionMissing(player) {
  return Boolean(player?.projection_missing || player?.has_projection === false);
}

export function showVibePts(player, vibePts) {
  if (vibePts == null || projectionMissing(player)) return false;
  const p50 = Number(player?.p50);
  if (!Number.isFinite(p50)) return false;
  const vibe = Number(vibePts);
  if (!Number.isFinite(vibe)) return false;
  return Math.abs(vibe - p50) >= VIBE_DELTA_FLOOR;
}
