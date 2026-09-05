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
      { id: "decisions", label: "Decisions", value: "Retry" },
    ];
  }
  if (loading) {
    return [
      { id: "board", label: "Board", value: "Reading" },
      { id: "decisions", label: "Decisions", value: "—" },
    ];
  }
  if (emptyRoster) {
    return [
      { id: "board", label: "Board", value: "Empty", tone: "warn" },
      { id: "decisions", label: "Decisions", value: "Waiting on roster" },
    ];
  }
  return [
    {
      id: "decisions",
      label: "Decisions",
      value: poorCoverage ? "—" : String(counts.decisions ?? 0),
    },
    { id: "bye", label: "On bye", value: String(counts.on_bye ?? 0) },
    { id: "injured", label: "Injured", value: String(counts.injured ?? 0) },
    { id: "ranges", label: "Wide ranges", value: String(counts.wide_ranges ?? 0) },
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
  return headline || syncedLabel || "";
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
  return { kind: "refresh", label: "Refresh projections" };
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
