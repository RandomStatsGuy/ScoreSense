import React, { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { initAnalytics, trackPageView } from "./analytics";

/** Sends a GA4 page_view on every in-app route change. */
export default function AnalyticsListener() {
  const location = useLocation();

  useEffect(() => {
    initAnalytics();
  }, []);

  useEffect(() => {
    trackPageView(location);
  }, [location.pathname, location.search]);

  return null;
}
