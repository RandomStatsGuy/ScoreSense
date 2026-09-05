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

export function weekHeroCopy({
  loadFailed = false,
  emptyRoster = false,
  unlinked = false,
  draftCompleted = false,
  poorCoverage = false,
  decisionCount = 0,
  weekLabel = "This week",
} = {}) {
  if (loadFailed) {
    return {
      heading: "Could not load this week's board.",
      support: "The slots stay empty until this request finishes. Reload this week, or open Draft if you still need a roster.",
      chip: weekLabel || "Needs refresh",
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
  loadFailed = false,
  emptyRoster = false,
  unlinked = false,
  poorCoverage = false,
  counts = {},
} = {}) {
  if (loadFailed) {
    return [
      { id: "board", label: "Board", value: "Failed", tone: "warn" },
      { id: "decisions", label: "Decisions", value: "Locked" },
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
  if (loadFailed) return "Reload this week. If you still need a roster, open Draft.";
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
  loadFailed = false,
  emptyRoster = false,
  unlinked = false,
  canSync = false,
  draftCompleted = false,
  sleeperStale = false,
} = {}) {
  if (loadFailed) return { kind: "retry", label: "Reload this week" };
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
      title: "This week's board did not load.",
      body: "Reload this week. If you still need a roster, open Draft.",
    };
  }
  if (loading && !emptyRoster && !unlinked) {
    return {
      title: "Loading this week…",
      body: "Sit/start waits until the board is here.",
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
