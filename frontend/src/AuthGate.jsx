import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import {
  fetchAuthConfig,
  fetchMe,
  handleAuthCallback,
  logout,
  notifyAuthChanged,
} from "./auth";
import { AuthContext } from "./AuthContext";
import { safeAuthNext } from "./authPresentation";

const PUBLIC_PATH_PREFIXES = [
  "/terms",
  "/privacy",
  "/sms-alerts",
  "/auth/",
  "/lobby",
  "/login",
  "/register",
  "/signup",
];

function isPublicAuthPath(pathname, search) {
  if (pathname === "/login" || pathname === "/register" || pathname === "/signup") {
    return true;
  }
  if (PUBLIC_PATH_PREFIXES.some((p) => pathname === p || pathname.startsWith(p))) {
    return true;
  }
  if (new URLSearchParams(search).has("invite")) {
    return true;
  }
  return false;
}

export default function AuthGate({ children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [hubAuthRequired, setHubAuthRequired] = useState(true);
  const [patreonConfigured, setPatreonConfigured] = useState(false);
  const [googleConfigured, setGoogleConfigured] = useState(false);
  const [termsUrl, setTermsUrl] = useState("");
  const [privacyUrl, setPrivacyUrl] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [user, setUser] = useState(null);
  const [error, setError] = useState("");
  const [hubDemo, setHubDemo] = useState({ available: false });

  const refreshMe = useCallback(async () => {
    const me = await fetchMe();
    setAuthenticated(Boolean(me.authenticated));
    setUser(me.user || null);
    return me;
  }, []);

  useEffect(() => {
    handleAuthCallback();
    (async () => {
      try {
        const config = await fetchAuthConfig();
        setAuthRequired(config.auth_required);
        setHubAuthRequired(config.hub_auth_required !== false);
        setPatreonConfigured(config.patreon_configured);
        setGoogleConfigured(Boolean(config.google_configured));
        setTermsUrl(config.terms_url || "");
        setPrivacyUrl(config.privacy_url || "");
        setHubDemo(config.hub_demo || { available: false });
        await refreshMe();
      } catch (err) {
        setError(err.message || "Auth check failed");
      } finally {
        setReady(true);
      }
    })();
  }, [refreshMe]);

  useEffect(() => {
    const onAuthChanged = () => {
      refreshMe();
    };
    window.addEventListener("scoresense-auth-changed", onAuthChanged);
    return () => window.removeEventListener("scoresense-auth-changed", onAuthChanged);
  }, [refreshMe]);

  const openSignIn = useCallback((mode = "login") => {
    const next = `${location.pathname}${location.search}`;
    const path = mode === "register" ? "/register" : "/login";
    navigate(`${path}?next=${encodeURIComponent(safeAuthNext(next))}`);
  }, [location.pathname, location.search, navigate]);

  const onLogout = async () => {
    await logout();
    setAuthenticated(false);
    setUser(null);
    notifyAuthChanged();
  };

  const ctx = useMemo(
    () => ({
      ready,
      authenticated,
      user,
      hubAuthRequired,
      termsUrl,
      privacyUrl,
      patreonConfigured,
      googleConfigured,
      hubDemo,
      signInOpen: false,
      openSignIn,
      closeSignIn: () => {},
      refreshAuth: refreshMe,
      logout: onLogout,
      error,
    }),
    [
      ready,
      authenticated,
      user,
      hubAuthRequired,
      termsUrl,
      privacyUrl,
      patreonConfigured,
      googleConfigured,
      hubDemo,
      openSignIn,
      refreshMe,
      error,
    ],
  );

  if (!ready) {
    return <div className="panel muted">Loading…</div>;
  }

  const allowPublic = isPublicAuthPath(location.pathname, location.search);

  if (authRequired && !authenticated && !allowPublic) {
    const next = `${location.pathname}${location.search}`;
    return (
      <Navigate
        to={`/login?next=${encodeURIComponent(safeAuthNext(next))}`}
        replace
      />
    );
  }

  return (
    <AuthContext.Provider value={ctx}>
      {children}
    </AuthContext.Provider>
  );
}
