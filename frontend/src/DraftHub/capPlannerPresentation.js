/** User-facing copy for Fantasy → Cap. */

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
