import React, { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { canTrackSessionPageView, initAnalytics, trackPageView } from "./analytics";
import { useAuth } from "./AuthContext";

/** Sends a GA4 page_view on every in-app route change. */
export default function AnalyticsListener() {
  const location = useLocation();
  const { ready, authenticated } = useAuth();
  const canTrack = canTrackSessionPageView({ pathname: location.pathname, ready, authenticated });

  useEffect(() => {
    initAnalytics();
  }, []);

  useEffect(() => {
    if (canTrack) trackPageView(location);
  }, [location.pathname, location.search, canTrack]);

  return null;
}
