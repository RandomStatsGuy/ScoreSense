import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../auth";
import { connectionErrorMessage, parseApiError } from "../format";
import useMobileLayout from "../useMobileLayout";
import MobileDataList from "../MobileDataList";

export default function LeagueInvites({ leagueId, hubContext, onChanged }) {
  const mobileLayout = useMobileLayout();
  const [email, setEmail] = useState("");
  const [teamName, setTeamName] = useState("");
  const [teams, setTeams] = useState([]);
  const [invites, setInvites] = useState([]);
  const [lockClaims, setLockClaims] = useState(true);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [lastInviteUrl, setLastInviteUrl] = useState("");
  const [lastEmailSent, setLastEmailSent] = useState(null);

  const loadMembers = useCallback(async () => {
    if (!leagueId) return;
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch(`/api/hub/league/${encodeURIComponent(leagueId)}/members`);
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      setTeams(data.teams || []);
      setInvites(data.invites || []);
      setLockClaims(data.hub_context?.lock_team_claims !== false);
    } catch (e) {
      setError(connectionErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [leagueId]);

  useEffect(() => {
    if (hubContext?.can_invite_members) {
      loadMembers();
    }
  }, [hubContext?.can_invite_members, loadMembers]);

  const sendInvite = async (e) => {
    e.preventDefault();
    if (!email.trim() || !teamName.trim()) return;
    setSending(true);
    setError("");
    setLastInviteUrl("");
    setLastEmailSent(null);
    try {
      const res = await apiFetch(`/api/hub/league/${encodeURIComponent(leagueId)}/invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), team_name: teamName.trim() }),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      setLastInviteUrl(data.invite?.invite_url || "");
      setLastEmailSent(data.invite?.email_sent ?? null);
      setEmail("");
      setTeamName("");
      await loadMembers();
      onChanged?.(data.hub_context);
    } catch (err) {
      setError(connectionErrorMessage(err));
    } finally {
      setSending(false);
    }
  };

  const revokeInvite = async (inviteId) => {
    setError("");
    try {
      const res = await apiFetch(
        `/api/hub/league/${encodeURIComponent(leagueId)}/invites/${encodeURIComponent(inviteId)}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error(await parseApiError(res));
      await loadMembers();
    } catch (err) {
      setError(connectionErrorMessage(err));
    }
  };

  const copyLink = async (url) => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      /* ignore */
    }
  };

  const releaseClaim = async (teamId) => {
    setError("");
    try {
      const res = await apiFetch(
        `/api/hub/league/${encodeURIComponent(leagueId)}/teams/${encodeURIComponent(teamId)}/release-claim`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error(await parseApiError(res));
      await loadMembers();
      onChanged?.();
    } catch (err) {
      setError(connectionErrorMessage(err));
    }
  };

  const toggleLockClaims = async () => {
    const next = !lockClaims;
    setError("");
    try {
      const res = await apiFetch(`/api/hub/league/${encodeURIComponent(leagueId)}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lock_team_claims: next }),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      setLockClaims(next);
      onChanged?.(res.ok ? undefined : null);
    } catch (err) {
      setError(connectionErrorMessage(err));
    }
  };

  if (!hubContext?.can_invite_members) return null;

  return (
    <section className={`panel hub-panel hub-panel-embedded${mobileLayout ? " hub-invites--mobile" : ""}`}>
      <h3>Invite league members</h3>
      <p className="chart-note">
        Sends an email with a join link when SMTP is configured on the server; otherwise copy the link below.
      </p>

      <label className="hub-lock-claims">
        <input type="checkbox" checked={lockClaims} onChange={toggleLockClaims} />
        Lock team claims
      </label>

      <form className={`hub-form-row hub-invite-form${mobileLayout ? " hub-form-row--stack" : ""}`} onSubmit={sendInvite}>
        <label>
          <span className="hub-field-label">Manager email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="owner@example.com"
            required
          />
        </label>
        <label>
          <span className="hub-field-label">Team name</span>
          <input
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
            placeholder="Exact name from your spreadsheet"
            required
          />
        </label>
        <button type="submit" className="btn-primary" disabled={sending}>
          {sending ? "Sending…" : "Send invite"}
        </button>
      </form>

      {lastInviteUrl && (
        <div className="hub-invite-link">
          {lastEmailSent === true && (
            <p className="chart-note hub-invite-success">Email sent to the manager with the join link.</p>
          )}
          {lastEmailSent === false && (
            <p className="chart-note">Email not configured — copy this link and send it yourself:</p>
          )}
          {lastEmailSent == null && (
            <span className="chart-note">Invite link (share if email is not configured):</span>
          )}
          <div className="hub-toolbar">
            <code className="hub-invite-url">{lastInviteUrl}</code>
            <button type="button" className="btn-ghost btn-sm" onClick={() => copyLink(lastInviteUrl)}>
              Copy link
            </button>
          </div>
        </div>
      )}

      {loading && <p className="chart-note">Loading members…</p>}

      {teams.length > 0 && (
        <div className="hub-invite-teams">
          <h4>Teams</h4>
          {mobileLayout ? (
            <MobileDataList>
              {teams.filter((t) => !t.is_commissioner).map((t) => (
                <div key={t.id} className="hub-invite-mobile-card">
                  <div>
                    <strong>{t.name}</strong>
                    <span className="table-meta">
                      {t.user_sub ? " · linked" : " · unclaimed"}
                    </span>
                  </div>
                  {t.user_sub ? (
                    <button type="button" className="btn-ghost btn-sm" onClick={() => releaseClaim(t.id)}>
                      Release claim
                    </button>
                  ) : null}
                </div>
              ))}
            </MobileDataList>
          ) : (
          <ul className="hub-invite-list">
            {teams.filter((t) => !t.is_commissioner).map((t) => (
              <li key={t.id}>
                <strong>{t.name}</strong>
                {t.user_sub ? (
                  <>
                    <span className="table-meta"> · linked</span>
                    <button type="button" className="btn-ghost btn-sm" onClick={() => releaseClaim(t.id)}>
                      Release claim
                    </button>
                  </>
                ) : (
                  <span className="table-meta"> · unclaimed</span>
                )}
              </li>
            ))}
          </ul>
          )}
        </div>
      )}

      {invites.length > 0 && (
        <div className="hub-invite-pending">
          <h4>Pending invites</h4>
          <ul className="hub-invite-list">
            {invites.filter((i) => i.status === "pending").map((inv) => (
              <li key={inv.id}>
                <strong>{inv.team_name}</strong>
                <span className="table-meta"> · {inv.email}</span>
                <div className="hub-toolbar">
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    onClick={() => copyLink(`${window.location.origin}/?invite=${inv.token}`)}
                  >
                    Copy link
                  </button>
                  <button type="button" className="btn-ghost btn-sm" onClick={() => revokeInvite(inv.id)}>
                    Revoke
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && <div className="error">{error}</div>}
    </section>
  );
}
