/** Command-board layout for Fantasy → This Week. */

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
    const hit = remaining.find((player) => !used.has(player.player_id) && pred(player));
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
    (pid && String(decision.starter_player_id) === String(pid))
    || decision.starter_slot === slot.slot
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
  emptyRoster = false,
  unlinked = false,
  poorCoverage = false,
  decisionCount = 0,
  weekLabel = "This week",
} = {}) {
  if (emptyRoster || unlinked) {
    return {
      heading: "Set the board.",
      support: "Sync the league and the empty slots fill with this week's starters.",
      chip: weekLabel || "Needs sync",
      chipTone: "readonly",
    };
  }
  if (poorCoverage) {
    return {
      heading: "Projections aren't ready to call the week.",
      support: "The board still loads from your roster. Lineup calls wait until coverage improves.",
      chip: weekLabel,
      chipTone: "readonly",
    };
  }
  if (decisionCount > 0) {
    return {
      heading: decisionCount === 1
        ? "One lineup call on the board."
        : `${decisionCount} lineup calls on the board.`,
      support: "A swap is flagged only when a bench player meaningfully outprojects the starter.",
      chip: weekLabel,
      chipTone: "active",
    };
  }
  return {
    heading: "The board is set.",
    support: "No high-value swaps this week. Check bye and injury flags on the slots.",
    chip: weekLabel,
    chipTone: "active",
  };
}

export function weekRailItems({
  emptyRoster = false,
  unlinked = false,
  poorCoverage = false,
  counts = {},
} = {}) {
  if (emptyRoster || unlinked) {
    return [
      { id: "board", label: "Board", value: "Empty", tone: "warn" },
      { id: "decisions", label: "Decisions", value: "Locked" },
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
  emptyRoster = false,
  unlinked = false,
  poorCoverage = false,
  headline = "",
  syncedLabel = "",
} = {}) {
  if (unlinked) return "Link Sleeper, then sync to fill the board.";
  if (emptyRoster) return "Sync from Sleeper to load this week's board.";
  if (poorCoverage) return "Waiting on projection coverage before lineup advice is useful.";
  return headline || syncedLabel || "";
}

export function weekPrimaryAction({
  emptyRoster = false,
  unlinked = false,
  canSync = false,
} = {}) {
  if ((emptyRoster || unlinked) && canSync) {
    return { kind: "sync", label: "Sync league" };
  }
  if (unlinked) return { kind: "setup", label: "League settings" };
  if (emptyRoster) return { kind: "roster", label: "Add contracts" };
  return { kind: "refresh", label: "Refresh projections" };
}

export function trophyStripCopy({ boardReady = true, loading = false } = {}) {
  if (loading) return "Loading league trophies…";
  if (!boardReady) return "Voting after the board is live.";
  return "One vote per trophy. Reactions unlock after you win the matchup.";
}

export function boardTitle(weekLabel) {
  return weekLabel ? `${weekLabel} board` : "This week board";
}
