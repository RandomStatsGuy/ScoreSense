import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  fetchAuthConfig,
  fetchMe,
  handleAuthCallback,
  loginWithPatreon,
  logout,
  notifyAuthChanged,
} from "./auth";
import AccountAuth from "./AccountAuth";
import LegalLinks from "./LegalLinks";
import { AuthContext } from "./AuthContext";
import { PRODUCT_NAME, STUDIO_NAME } from "./brand";

const PUBLIC_PATH_PREFIXES = ["/terms", "/privacy", "/auth/"];

function isPublicAuthPath(pathname, search) {
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
  const [ready, setReady] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [hubAuthRequired, setHubAuthRequired] = useState(true);
  const [patreonConfigured, setPatreonConfigured] = useState(false);
  const [termsUrl, setTermsUrl] = useState("");
  const [privacyUrl, setPrivacyUrl] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [user, setUser] = useState(null);
  const [error, setError] = useState("");
  const [signInOpen, setSignInOpen] = useState(false);

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
        setTermsUrl(config.terms_url || "");
        setPrivacyUrl(config.privacy_url || "");
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

  const onAuthed = async () => {
    setSignInOpen(false);
    await refreshMe();
    notifyAuthChanged();
  };

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
      signInOpen,
      openSignIn: () => setSignInOpen(true),
      closeSignIn: () => setSignInOpen(false),
      refreshAuth: refreshMe,
      logout: onLogout,
    }),
    [ready, authenticated, user, hubAuthRequired, termsUrl, privacyUrl, patreonConfigured, signInOpen, refreshMe],
  );

  if (!ready) {
    return <div className="panel muted">Loading…</div>;
  }

  const allowPublic = isPublicAuthPath(location.pathname, location.search);

  if (authRequired && !authenticated && !allowPublic) {
    return (
      <div className="auth-shell">
        <AccountAuth
          onAuthed={onAuthed}
          title={`Sign in to ${PRODUCT_NAME}`}
          subtitle="Patreon login below, or create a free account."
          termsUrl={termsUrl}
          privacyUrl={privacyUrl}
        />
        {patreonConfigured && (
          <section className="panel auth-panel auth-panel-secondary">
            <h3 className="hub-panel-subtitle">Patreon subscribers</h3>
            <p className="chart-note">Active patrons only.</p>
            {error && <div className="error">{error}</div>}
            <button
              type="button"
              className="btn-ghost"
              onClick={() =>
                loginWithPatreon(`${window.location.pathname}${window.location.search}`).catch(
                  (e) => setError(e.message),
                )
              }
            >
              Log in with Patreon
            </button>
          </section>
        )}
        <LegalLinks termsUrl={termsUrl} privacyUrl={privacyUrl} className="auth-legal-footer" />
        <p className="app-studio-credit">
          {PRODUCT_NAME} · {STUDIO_NAME}
        </p>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={ctx}>
      {signInOpen && !authenticated && (
        <div className="auth-modal-overlay" role="dialog" aria-modal="true" aria-label="Sign in">
          <div className="auth-modal-card">
            <button
              type="button"
              className="auth-modal-close btn-ghost btn-sm"
              onClick={() => setSignInOpen(false)}
              aria-label="Close"
            >
              ✕
            </button>
            <AccountAuth
              onAuthed={onAuthed}
              title={`Sign in to ${PRODUCT_NAME}`}
              subtitle="Saves league, Sleeper link, and contracts."
              termsUrl={termsUrl}
              privacyUrl={privacyUrl}
            />
          </div>
        </div>
      )}
      {children}
    </AuthContext.Provider>
  );
}
