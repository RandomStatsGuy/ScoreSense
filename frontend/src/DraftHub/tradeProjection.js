import { dropDeadCapAmount, fmtSal } from "./rosterFormat";
import { HUB_POS_ORDER, normalizeHubPosition } from "./hubPositions";

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function findRow(rowByPlayer, rosterByTeam, teamId, playerId) {
  return rowByPlayer[playerId]
    || (rosterByTeam[teamId] || []).find((r) => r.player_id === playerId)
    || null;
}

/**
 * Live post-trade cap / position counts for a team (client-side, mirrors validate preview).
 */
export function projectTeamTradeStats({
  teamId,
  statsByTeam,
  rosterByTeam,
  rowByPlayer,
  parties,
  deadCapAssignments,
  rules,
  salaryCap,
}) {
  if (!teamId) return null;
  const base = statsByTeam[teamId] || {};
  const baseCommitted = Number(base.committed || 0);
  const baseDead = Number(base.dead_cap || 0);
  const byPos = { ...(base.by_position_count || {}) };

  let committedDelta = 0;

  const bumpPos = (position, delta) => {
    const pos = normalizeHubPosition(position);
    if (!pos) return;
    byPos[pos] = (byPos[pos] || 0) + delta;
  };

  const party = (parties || []).find((p) => p.team_id === teamId);
  if (party) {
    (party.sends || []).forEach((s) => {
      const row = findRow(rowByPlayer, rosterByTeam, teamId, s.player_id);
      committedDelta -= Number(row?.salary || 0);
      bumpPos(row?.position, -1);
    });
    (party.drops || []).forEach((pid) => {
      const row = findRow(rowByPlayer, rosterByTeam, teamId, pid);
      committedDelta -= Number(row?.salary || 0);
      bumpPos(row?.position, -1);
    });
  }

  (parties || []).forEach((p) => {
    if (p.team_id === teamId) return;
    (p.sends || []).forEach((s) => {
      if (s.to_team_id !== teamId) return;
      const row = findRow(rowByPlayer, rosterByTeam, p.team_id, s.player_id);
      committedDelta += Number(row?.salary || 0);
      bumpPos(row?.position, 1);
    });
  });

  let deadDelta = 0;
  (deadCapAssignments || []).forEach((a) => {
    if (a.assigned_to_team_id !== teamId) return;
    const stillDropped = (parties || []).some(
      (p) => p.team_id === a.from_team_id && (p.drops || []).includes(a.player_id),
    );
    if (!stillDropped) return;
    if (a.amount != null && Number.isFinite(Number(a.amount))) {
      deadDelta += Number(a.amount);
      return;
    }
    const row = findRow(rowByPlayer, rosterByTeam, a.from_team_id, a.player_id);
    deadDelta += dropDeadCapAmount(row, rules);
  });

  const committed = round2(baseCommitted + committedDelta);
  const dead = round2(baseDead + deadDelta);
  const cap = Number(salaryCap ?? 200);
  const unspent = round2(cap - committed - dead);
  const by_position_count = {};
  HUB_POS_ORDER.forEach((pos) => {
    const n = byPos[pos];
    if (n > 0) by_position_count[pos] = n;
  });
  Object.entries(byPos).forEach(([pos, n]) => {
    if (n > 0 && by_position_count[pos] == null) by_position_count[pos] = n;
  });

  const dirty = committedDelta !== 0 || deadDelta !== 0
    || Object.keys(by_position_count).some((pos) => (by_position_count[pos] || 0) !== (base.by_position_count?.[pos] || 0))
    || Object.keys(base.by_position_count || {}).some((pos) => (by_position_count[pos] || 0) !== (base.by_position_count[pos] || 0));

  return {
    committed,
    dead_cap: dead,
    unspent,
    by_position_count,
    base: {
      committed: round2(baseCommitted),
      dead_cap: round2(baseDead),
      unspent: round2(cap - baseCommitted - baseDead),
      by_position_count: base.by_position_count || {},
    },
    dirty,
  };
}

export function formatStatDelta(base, next) {
  if (base == null || next == null || Math.abs(Number(next) - Number(base)) < 0.01) return null;
  const d = Number(next) - Number(base);
  const sign = d > 0 ? "+" : "";
  return `${sign}${fmtSal(d)}`;
}
