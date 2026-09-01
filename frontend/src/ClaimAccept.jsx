import React, { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { apiFetch } from "./auth";
import { connectionErrorMessage, parseApiError } from "./format";
import AccountAuth from "./AccountAuth";
import { useAuth } from "./AuthContext";
import { hubTeamLabel } from "./DraftHub/hubTeamLabel";
import { claimTokenFromSearch, dropClaimParam } from "./claimSearch";

export default function ClaimAccept({ authenticated, user, onAccepted, onDismiss }) {
  const { termsUrl, privacyUrl, patreonConfigured } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const token = claimTokenFromSearch(searchParams);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(Boolean(token));
  const [accepting, setAccepting] = useState(false);
  const [done, setDone] = useState(false);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState("");

  const finish = useCallback((payload) => {
    setDone(true);
    setSearchParams(dropClaimParam(searchParams), { replace: true });
    onAccepted?.(payload);
  }, [onAccepted, searchParams, setSearchParams]);

  useEffect(() => {
    if (!token || done) return undefined;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const res = await apiFetch(`/api/hub/claim/${encodeURIComponent(token)}`);
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
  }, [token, authenticated, user?.sub, done]);

  const acceptClaim = useCallback(async (body) => {
    if (!token || done) return;
    setAccepting(true);
    setError("");
    try {
      const res = await apiFetch(`/api/hub/claim/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      finish(data);
    } catch (e) {
      setError(connectionErrorMessage(e));
    } finally {
      setAccepting(false);
    }
  }, [token, done, finish]);

  if (!token || done) return null;

  const open = preview?.status === "open";
  const already = Boolean(preview?.already_member);

  return (
    <div className="invite-overlay" role="dialog" aria-labelledby="claim-title" aria-modal="true">
      <div className="invite-modal claim-modal panel">
        <h2 id="claim-title">Claim your team</h2>
        {loading && <p className="chart-note">Loading the league…</p>}
        {!loading && preview && (
          <>
            <p>
              {preview.league_name || "This league"}
              {preview.league_season ? ` · ${preview.league_season}` : ""}
            </p>
            <p className="chart-note">
              {already
                ? `${hubTeamLabel(preview.your_team)} is already yours. Open Draft to mark nights that work.`
                : "Sign in, pick the team you run, and you are in the league."}
            </p>
            {preview.status === "disabled" && (
              <p className="error">This invite link is turned off. Ask the commissioner for a new one.</p>
            )}
            {preview.status === "closed" && !already && (
              <p className="error">This league is no longer taking claims.</p>
            )}
            {preview.status === "full" && !already && (
              <p className="error">Every seat is claimed.</p>
            )}
          </>
        )}
        {!authenticated && open && !already && (
          <AccountAuth
            title="Sign in to claim a team"
            subtitle="A free ScoreSense account keeps this seat with you."
            termsUrl={termsUrl}
            privacyUrl={privacyUrl}
            patreonConfigured={patreonConfigured}
            patreonNext={`/hub/draft?claim=${encodeURIComponent(token)}`}
            onAuthed={() => window.dispatchEvent(new Event("scoresense-auth-changed"))}
          />
        )}
        {authenticated && already && (
          <div className="hub-toolbar">
            <button
              type="button"
              className="btn-primary"
              onClick={() => finish(preview)}
            >
              Open Draft
            </button>
          </div>
        )}
        {authenticated && open && !already && (
          <div className="claim-team-list">
            {(preview?.unclaimed_teams || []).map((team) => (
              <button
                key={team.id}
                type="button"
                className="claim-team-btn"
                disabled={accepting}
                onClick={() => acceptClaim({ team_id: team.id })}
              >
                <strong>{hubTeamLabel(team)}</strong>
                <span>{accepting ? "Claiming…" : "Take this seat"}</span>
              </button>
            ))}
            {preview?.can_create_seat ? (
              <form
                className="claim-open-seat"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!newName.trim()) return;
                  acceptClaim({ team_name: newName.trim() });
                }}
              >
                <label htmlFor="claim-new-name">Or take an open seat</label>
                <div className="draft-lobby-link-row">
                  <input
                    id="claim-new-name"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Your team name"
                    maxLength={40}
                  />
                  <button type="submit" className="btn-ghost btn-sm" disabled={accepting || !newName.trim()}>
                    {accepting ? "Joining…" : "Join"}
                  </button>
                </div>
              </form>
            ) : null}
          </div>
        )}
        {error && <div className="error">{error}</div>}
        <button
          type="button"
          className="btn-ghost btn-sm invite-dismiss"
          onClick={() => {
            setDone(true);
            setSearchParams(dropClaimParam(searchParams), { replace: true });
            onDismiss?.();
          }}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
