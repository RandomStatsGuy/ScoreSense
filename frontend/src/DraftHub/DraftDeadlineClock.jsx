import React, { useEffect, useState } from "react";
import { formatCountdown, secondsUntil } from "./draftRoomHelpers";

/** Isolated 1s countdown — avoids re-rendering the whole draft room. */
export default function DraftDeadlineClock({ deadline, className = "" }) {
  const [seconds, setSeconds] = useState(() => (deadline ? secondsUntil(deadline) : null));

  useEffect(() => {
    if (!deadline) {
      setSeconds(null);
      return undefined;
    }
    setSeconds(secondsUntil(deadline));
    const id = setInterval(() => setSeconds(secondsUntil(deadline)), 1000);
    return () => clearInterval(id);
  }, [deadline]);

  if (seconds == null) return null;
  return <span className={className}>{formatCountdown(seconds)}</span>;
}
