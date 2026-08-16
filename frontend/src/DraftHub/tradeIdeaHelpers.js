import { fmtSal } from "./rosterFormat.js";

/** Salary total for a send/receive package; prefer payload salary, fall back to roster row. */
export function packageSalaryTotal(legs, rowByPlayer) {
  return (legs || []).reduce((sum, x) => {
    const fromPayload = x?.salary != null ? Number(x.salary) : NaN;
    const fromRoster = Number(rowByPlayer?.[x?.player_id]?.salary);
    const sal = Number.isFinite(fromPayload) ? fromPayload : (Number.isFinite(fromRoster) ? fromRoster : 0);
    return sum + sal;
  }, 0);
}

export function ideaCapImpact(suggestion, rowByPlayer) {
  const sendSal = packageSalaryTotal(suggestion?.send, rowByPlayer);
  const recvSal = packageSalaryTotal(suggestion?.receive, rowByPlayer);
  return { sendSal, recvSal, net: recvSal - sendSal };
}

/** Surplus / roster-need framing for Ideas cards (SCORE-15). */
export function whyThisHelpsText(suggestion) {
  const fills = (suggestion?.fills_needs || []).filter(Boolean);
  const moves = (suggestion?.moves_surplus || []).filter(Boolean);
  if (fills.length && moves.length) {
    const needLabel = fills.length === 1 ? `${fills[0]} need` : `${fills.join(" / ")} needs`;
    return `Fills your ${needLabel} by moving ${moves.join(" / ")} surplus.`;
  }
  if (fills.length) {
    return fills.length === 1
      ? `Fills your ${fills[0]} roster need.`
      : `Fills your ${fills.join(" / ")} roster needs.`;
  }
  if (moves.length) {
    return `Moves ${moves.join(" / ")} surplus you can spare.`;
  }
  return suggestion?.rationale || "Matches complementary surplus and roster need.";
}

export function formatIdeaCapNet(net) {
  if (!Number.isFinite(net) || net === 0) return { text: "Even committed", tone: "" };
  if (net > 0) return { text: `+${fmtSal(net)} committed`, tone: "hub-value-delta-neg" };
  return { text: `${fmtSal(Math.abs(net))} freed`, tone: "hub-value-delta-pos" };
}
