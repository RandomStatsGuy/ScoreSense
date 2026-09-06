import React, { useEffect, useState } from "react";
import { formatCountdown, secondsUntil } from "./draftRoomHelpers";

/** Isolated 1s countdown — avoids re-rendering the whole draft room. */
export function useDeadlineSeconds(deadline, paused = false) {
  const [seconds, setSeconds] = useState(() => (deadline ? secondsUntil(deadline) : null));

  useEffect(() => {
    if (paused || !deadline) {
      setSeconds(deadline ? secondsUntil(deadline) : null);
      return undefined;
    }
    setSeconds(secondsUntil(deadline));
    const id = setInterval(() => setSeconds(secondsUntil(deadline)), 250);
    return () => clearInterval(id);
  }, [deadline, paused]);

  return seconds;
}

export default function DraftDeadlineClock({
  deadline,
  paused = false,
  pausedLabel = "Paused",
  className = "",
}) {
  const seconds = useDeadlineSeconds(deadline, paused);

  if (paused) return <span className={className}>{pausedLabel}</span>;
  if (seconds == null) return null;
  return <span className={className}>{formatCountdown(seconds)}</span>;
}
