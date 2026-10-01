import { useEffect } from "react";
import { currentFantasyVisit, measureFantasyReady } from "./fantasyPerformance";
// The ready effect runs after the data commit. Record it separately from the
// next two frames: waiting is not proof of CPU work or physical presentation.
export default function useFantasyReady(destination, phase, ready) {
  const visitId = currentFantasyVisit()?.id;
  useEffect(() => {
    const owner = currentFantasyVisit();
    if (!ready || !owner) return;
    return measureFantasyReady(destination, phase, owner);
  }, [destination, phase, ready, visitId]);
}
