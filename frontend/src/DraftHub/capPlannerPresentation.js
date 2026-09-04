/** User-facing copy for Fantasy → Cap. */

export const CAP_MOVE_COPY = {
  title: "After this move",
  hint: "Choose a name to cut, or enter a bid. The leftover below updates.",
  cutLabel: "Cut",
  bidLabel: "Bid",
  none: "No cut",
};

export function leftoverAfterMove({ remaining = 0, cutSalary = 0, cutRefundPct = 0.5, bid = 0 } = {}) {
  const rem = Number(remaining) || 0;
  const salary = Number(cutSalary) || 0;
  const refund = Number.isFinite(Number(cutRefundPct)) ? Number(cutRefundPct) : 0.5;
  const freed = salary * refund;
  const spend = Number(bid) || 0;
  return rem + freed - spend;
}

export function leftoverAfterMoveYears({
  years = [],
  cutHits = [],
  cutRefundPct = 0.5,
  bid = 0,
} = {}) {
  return years.map((year, idx) => {
    const remaining = Number(year.cap_remaining) || 0;
    const hit = Number(cutHits[idx] || 0);
    const next = idx === 0
      ? remaining + hit * (Number(cutRefundPct) || 0) - (Number(bid) || 0)
      : remaining + hit;
    return { ...year, cap_remaining: next };
  });
}

export function capHeroCopy({ empty = false, preDraft = false } = {}) {
  if (empty) {
    return {
      eyebrow: "Cap",
      heading: "Can you afford the bid after the cut?",
      support: "No contracts yet. Add them on My team or leftover cap is a guess.",
    };
  }
  return {
    eyebrow: "Cap",
    heading: "Can you afford the bid after the cut?",
    support: preDraft
      ? "Final-year deals leave unless you extend. Cut the wrong name and you eat dead cap into the draft."
      : "Committed salary and dead cap are already spent. Leftover is what you can still bid.",
  };
}
