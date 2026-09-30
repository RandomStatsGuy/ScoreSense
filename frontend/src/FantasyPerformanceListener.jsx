import { useLayoutEffect } from "react";
import { useLocation } from "react-router-dom";
import { beginFantasyVisit, currentFantasyVisit, fantasyDestination } from "./fantasyPerformance";
export default function FantasyPerformanceListener() {
  const {pathname} = useLocation();
  useLayoutEffect(() => {
    const current = currentFantasyVisit();
    if (current?.destination !== fantasyDestination(pathname)) beginFantasyVisit(pathname);
  }, [pathname]);
  return null;
}
