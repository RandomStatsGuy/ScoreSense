import { useEffect } from "react";
import { currentFantasyVisit, markFantasyReady } from "./fantasyPerformance";
// Two frame callbacks let the data commit paint. This excludes image decoding
// and ongoing score freshness; each explicitly named phase has its own meaning.
export default function useFantasyReady(destination, phase, ready) {
  const visitId = currentFantasyVisit()?.id;
  useEffect(() => {
    const owner = currentFantasyVisit();
    if (!ready || !owner) return;
    let second;
    const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => markFantasyReady(destination, phase, owner)); });
    return () => { cancelAnimationFrame(first); if (second) cancelAnimationFrame(second); };
  }, [destination, phase, ready, visitId]);
}
