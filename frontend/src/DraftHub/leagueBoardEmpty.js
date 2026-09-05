/** Shared empty-state for This Week, My team, and Game center. */

export const LEAGUE_BOARD_EMPTY_COPY = Object.freeze({
  lockNight: {
    heading: "Need a roster to set a lineup.",
    support: "Lock a night so seats fill. Empty seats draft as bots.",
    rail: "Waiting on roster",
    note: "Lock a night on Draft. Empty seats draft as bots.",
    actionLabel: "Lock a night",
  },
  linkSleeper: {
    heading: "Need a roster to set a lineup.",
    support: "Link Sleeper on Access & imports or the slots stay empty.",
    rail: "Waiting on roster",
    note: "Link Sleeper on Roster management · Access & imports.",
    actionLabel: "Link Sleeper",
  },
  sync: {
    heading: "Need a roster to set a lineup.",
    support: "The league is linked. Use Sync league in the strip — a sync can overwrite contracts.",
    rail: "Waiting on roster",
    note: "Use Sync league in the league strip.",
    actionLabel: "Sync league",
  },
});

/**
 * Branch the empty board on league state.
 * native pre-draft → Draft; unlinked Sleeper → Access; linked+stale → strip sync.
 */
export function leagueBoardEmpty({
  emptyRoster = false,
  sleeperLinked = false,
  draftCompleted = false,
  sleeperStale = false,
} = {}) {
  if (!emptyRoster) return null;
  if (!sleeperLinked && !draftCompleted) {
    const copy = LEAGUE_BOARD_EMPTY_COPY.lockNight;
    return {
      kind: "lock-night",
      ...copy,
      action: { kind: "room", label: copy.actionLabel },
    };
  }
  if (!sleeperLinked) {
    const copy = LEAGUE_BOARD_EMPTY_COPY.linkSleeper;
    return {
      kind: "link-sleeper",
      ...copy,
      action: { kind: "office-access", label: copy.actionLabel },
    };
  }
  const copy = LEAGUE_BOARD_EMPTY_COPY.sync;
  return {
    kind: "strip-sync",
    ...copy,
    stale: Boolean(sleeperStale),
    action: { kind: "strip-sync", label: copy.actionLabel },
  };
}
