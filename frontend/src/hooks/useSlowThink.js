import { useEffect, useState } from "react";

/** Show a thinking overlay only after a load has been slow (> delayMs). */
export default function useSlowThink(busy, delayMs = 2000) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!busy) {
      setShow(false);
      return undefined;
    }
    const timer = window.setTimeout(() => setShow(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [busy, delayMs]);
  return show;
}
