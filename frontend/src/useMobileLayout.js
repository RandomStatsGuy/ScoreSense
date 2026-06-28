import { useEffect, useState } from "react";
import { MOBILE_MEDIA_QUERY } from "./breakpoints";

export default function useMobileLayout() {
  const [mobile, setMobile] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(MOBILE_MEDIA_QUERY).matches;
  });

  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mq = window.matchMedia(MOBILE_MEDIA_QUERY);
    const onChange = (event) => setMobile(event.matches);
    if (mq.addEventListener) {
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    }
    mq.addListener(onChange);
    return () => mq.removeListener(onChange);
  }, []);

  return mobile;
}
