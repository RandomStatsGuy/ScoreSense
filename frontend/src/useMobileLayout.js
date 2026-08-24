import { useEffect, useState } from "react";
import { MOBILE_MEDIA_QUERY, nextMobileLayout } from "./breakpoints";

export default function useMobileLayout() {
  const [mobile, setMobile] = useState(() => {
    if (typeof window === "undefined") return false;
    return nextMobileLayout(false, window.innerWidth);
  });

  useEffect(() => {
    const apply = () => {
      setMobile((was) => nextMobileLayout(was, window.innerWidth));
    };
    apply();
    window.addEventListener("resize", apply);
    const mq = window.matchMedia?.(MOBILE_MEDIA_QUERY);
    if (mq?.addEventListener) {
      mq.addEventListener("change", apply);
      return () => {
        window.removeEventListener("resize", apply);
        mq.removeEventListener("change", apply);
      };
    }
    if (mq?.addListener) {
      mq.addListener(apply);
      return () => {
        window.removeEventListener("resize", apply);
        mq.removeListener(apply);
      };
    }
    return () => window.removeEventListener("resize", apply);
  }, []);

  return mobile;
}
