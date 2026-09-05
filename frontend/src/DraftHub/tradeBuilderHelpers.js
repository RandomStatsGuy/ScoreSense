import { HUB_POS_ORDER } from "./hubPositions.js";
import { fmtSal } from "./rosterFormat.js";
import { TRADES_COPY } from "./leagueTradesPresentation.js";

const THIN_STARTER = { QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DEF: 1 };

export function packageFingerprint(parties, deadCapAssignments) {
  return JSON.stringify({
    parties: (parties || []).map((p) => ({
      team_id: p.team_id || "",
      sends: (p.sends || []).map((s) => ({
        player_id: s.player_id,
        to_team_id: s.to_team_id,
      })),
      drops: [...(p.drops || [])],
    })),
    dead: (deadCapAssignments || []).map((a) => ({
      player_id: a.player_id,
      from_team_id: a.from_team_id,
      assigned_to_team_id: a.assigned_to_team_id,
    })),
  });
}

/** Partner card line: "$22 free · thin at TE". */
export function partnerCardMeta({ stats, insight, byPos } = {}) {
  const free = stats?.unspent ?? insight?.cap_remaining;
  const needs = (insight?.their_need || []).filter(Boolean);
  const counts = byPos || stats?.by_position_count || {};
  const thin = needs.length
    ? needs.slice(0, 2)
    : HUB_POS_ORDER.filter((pos) => {
      const n = counts[pos] || 0;
      const starter = THIN_STARTER[pos] || 1;
      return n < starter;
    }).slice(0, 2);
  const parts = [];
  if (free != null && Number.isFinite(Number(free))) {
    parts.push(`${fmtSal(free)} free`);
  }
  if (thin.length) parts.push(`thin at ${thin.join(" / ")}`);
  return parts.join(" · ");
}

export function sendGetCopy({ isYours, playerName, destName, srcName }) {
  if (isYours) {
    return {
      button: TRADES_COPY.sendBtnYours,
      aria: TRADES_COPY.sendTo(playerName, destName),
    };
  }
  return {
    button: TRADES_COPY.getBtnTheirs,
    aria: TRADES_COPY.getFrom(playerName, srcName),
  };
}

export function packageLegFlow(leg, teamName) {
  if (leg.drop) return TRADES_COPY.dropFlow(teamName(leg.from));
  return TRADES_COPY.sendFlow(teamName(leg.from), teamName(leg.to));
}

export function validationBanner(status, errors, message) {
  if (status === "pending") {
    return {
      variant: "info",
      live: "polite",
      role: "status",
      text: TRADES_COPY.checking,
    };
  }
  if (status === "valid") {
    return {
      variant: "ready",
      live: "polite",
      role: "status",
      text: message || TRADES_COPY.valid,
    };
  }
  if (status === "invalid") {
    return {
      variant: "danger",
      live: "assertive",
      role: "alert",
      text: (errors || []).filter(Boolean).join(" ") || TRADES_COPY.invalidFallback,
    };
  }
  return null;
}

export function notifyPartnerNames(teams, partnerIds, myTeamId) {
  return (partnerIds || [])
    .filter((id) => id && id !== myTeamId)
    .map((id) => {
      const team = (teams || []).find((t) => t.id === id);
      return team?.owner_name || team?.name || "";
    })
    .filter(Boolean);
}
