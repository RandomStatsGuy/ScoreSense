import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "./auth";
import { connectionErrorMessage, parseApiError } from "./format";
import AccountAuth from "./AccountAuth";
import { useAuth } from "./AuthContext";

function inviteTokenFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get("invite")?.trim() || "";
}

function clearInviteParam() {
  const url = new URL(window.location.href);
  url.searchParams.delete("invite");
  window.history.replaceState({}, "", url.pathname + url.search + url.hash);
}

export default function InviteAccept({ authenticated, user, onAccepted, onDismiss }) {
  const { termsUrl, privacyUrl, patreonConfigured } = useAuth();
  const token = inviteTokenFromUrl();
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(Boolean(token));
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const res = await apiFetch(`/api/hub/invites/${encodeURIComponent(token)}`);
        if (!res.ok) throw new Error(await parseApiError(res));
        const data = await res.json();
        if (!cancelled) setPreview(data);
      } catch (e) {
        if (!cancelled) setError(connectionErrorMessage(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const acceptInvite = useCallback(async () => {
    if (!token) return;
    setAccepting(true);
    setError("");
    try {
      const res = await apiFetch("/api/hub/invites/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      clearInviteParam();
      onAccepted?.(data);
    } catch (e) {
      setError(connectionErrorMessage(e));
    } finally {
      setAccepting(false);
    }
  }, [token, onAccepted]);

  if (!token) return null;

  const emailMatches = preview?.email
    && user?.email
    && preview.email.toLowerCase() === user.email.toLowerCase();

  return (
    <div className="invite-overlay" role="dialog" aria-labelledby="invite-title">
      <div className="invite-modal panel">
        <h2 id="invite-title">League invite</h2>
        {loading && <p className="chart-note">Loading invite…</p>}
        {!loading && preview && (
          <>
            <p>
              You&apos;ve been invited to manage <strong>{preview.team_name}</strong>
              {preview.league_name ? ` in ${preview.league_name}` : ""}.
            </p>
            <p className="chart-note">
              Sign in with <strong>{preview.email}</strong> to accept.
            </p>
            {preview.status !== "pending" && (
              <p className="error">This invite is no longer active.</p>
            )}
          </>
        )}
        {!authenticated && preview?.status === "pending" && (
          <AccountAuth
            title="Sign in to join your league"
            subtitle={`Sign in with ${preview.email}`}
            defaultEmail={preview.email}
            termsUrl={termsUrl}
            privacyUrl={privacyUrl}
            patreonConfigured={patreonConfigured}
            patreonNext={`/?invite=${encodeURIComponent(token)}`}
            onAuthed={() => window.dispatchEvent(new Event("scoresense-auth-changed"))}
          />
        )}
        {authenticated && preview?.status === "pending" && !emailMatches && (
          <p className="error">
            Wrong account — sign in as {preview.email}.
          </p>
        )}
        {authenticated && preview?.status === "pending" && emailMatches && (
          <div className="hub-toolbar">
            <button type="button" className="btn-primary" disabled={accepting} onClick={acceptInvite}>
              {accepting ? "Joining…" : "Join league"}
            </button>
          </div>
        )}
        {error && <div className="error">{error}</div>}
        <button type="button" className="btn-ghost btn-sm invite-dismiss" onClick={() => { clearInviteParam(); onDismiss?.(); }}>
          Dismiss
        </button>
      </div>
    </div>
  );
}

export { inviteTokenFromUrl, clearInviteParam };
