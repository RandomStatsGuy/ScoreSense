import React, { useCallback, useEffect, useState } from "react";
import useAsyncActionScope from "../ui/useAsyncActionScope";
import { apiFetch } from "../auth";
import { connectionErrorMessage, parseApiError } from "../format";
import useMobileLayout from "../useMobileLayout";
import MobileDataList from "../MobileDataList";
import { hubTeamLabel } from "./hubTeamLabel";
import { leagueInvitePath } from "../routes";
import {
  memberInviteExplainer,
} from "./leagueAccessCopy";

export default function LeagueInvites(props) {
  const {leagueId, hubContext} = props;
  return <LeagueInvitesView key={JSON.stringify([leagueId, hubContext?.can_invite_members, hubContext?.is_primary_commissioner, hubContext?.readonly])} {...props} />;
}
function LeagueInvitesView({ leagueId, hubContext, onChanged }) {
  const captureScope = useAsyncActionScope(leagueId);
  const mobileLayout = useMobileLayout();
  const [email, setEmail] = useState("");
  const [teamName, setTeamName] = useState("");
  const [coCommissioner, setCoCommissioner] = useState(false);
  const [teams, setTeams] = useState([]);
  const [commissionerSub, setCommissionerSub] = useState("");
  const [invites, setInvites] = useState([]);
  const [lockClaims, setLockClaims] = useState(true);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [lastInviteUrl, setLastInviteUrl] = useState("");
  const [lastEmailSent, setLastEmailSent] = useState(null);

  const busy = sending || pending || loading;
  const loadMembers = useCallback(async () => {
    const isCurrent = captureScope();
    if (!leagueId) return;
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch(`/api/hub/league/${encodeURIComponent(leagueId)}/members`);
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      if (!isCurrent()) return;
      setTeams(data.teams || []);
      setInvites(data.invites || []);
      setCommissionerSub(data.commissioner_sub || "");
      setLockClaims(data.hub_context?.lock_team_claims !== false);
    } catch (e) {
      if (isCurrent()) setError(connectionErrorMessage(e));
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [leagueId, captureScope]);

  useEffect(() => {
    if (hubContext?.can_invite_members) {
      loadMembers();
    }
  }, [hubContext?.can_invite_members, loadMembers]);

  const sendInvite = async (e) => {
    const isCurrent = captureScope();
    e.preventDefault();
    if (busy || !hubContext?.can_invite_members || !email.trim() || !teamName.trim()) return;
    setSending(true);
    setError("");
    setLastInviteUrl("");
    setLastEmailSent(null);
    try {
      const res = await apiFetch(`/api/hub/league/${encodeURIComponent(leagueId)}/invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          team_name: teamName.trim(),
          co_commissioner: coCommissioner,
        }),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      if (!isCurrent()) return;
      setLastInviteUrl(data.invite?.invite_url || "");
      setLastEmailSent(data.invite?.email_sent ?? null);
      setEmail("");
      setTeamName("");
      setCoCommissioner(false);
      await loadMembers();
      if (!isCurrent()) return;
      onChanged?.(data.hub_context);
    } catch (err) {
      if (isCurrent()) setError(connectionErrorMessage(err));
    } finally {
      if (isCurrent()) setSending(false);
    }
  };

  const revokeInvite = async (inviteId) => {
    if (busy) return;
    const isCurrent = captureScope();
    setPending(true);
    setError("");
    try {
      const res = await apiFetch(
        `/api/hub/league/${encodeURIComponent(leagueId)}/invites/${encodeURIComponent(inviteId)}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error(await parseApiError(res));
      if (!isCurrent()) return;
      await loadMembers();
      if (!isCurrent()) return;
    } catch (err) {
      if (isCurrent()) setError(connectionErrorMessage(err));
    } finally {
      if (isCurrent()) setPending(false);
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
    if (busy) return;
    const isCurrent = captureScope();
    setPending(true);
    setError("");
    try {
      const res = await apiFetch(
        `/api/hub/league/${encodeURIComponent(leagueId)}/teams/${encodeURIComponent(teamId)}/release-claim`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error(await parseApiError(res));
      if (!isCurrent()) return;
      await loadMembers();
      if (!isCurrent()) return;
      onChanged?.();
    } catch (err) {
      if (isCurrent()) setError(connectionErrorMessage(err));
    } finally {
      if (isCurrent()) setPending(false);
    }
  };

  const toggleLockClaims = async () => {
    if (busy) return;
    const isCurrent = captureScope();
    setPending(true);
    const next = !lockClaims;
    setError("");
    try {
      const res = await apiFetch(`/api/hub/league/${encodeURIComponent(leagueId)}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lock_team_claims: next }),
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      if (!isCurrent()) return;
      setLockClaims(next);
      onChanged?.(res.ok ? undefined : null);
    } catch (err) {
      if (isCurrent()) setError(connectionErrorMessage(err));
    } finally {
      if (isCurrent()) setPending(false);
    }
  };

  if (!hubContext?.can_invite_members || hubContext?.readonly) return null;

  return (
    <section className={`panel hub-panel hub-panel-embedded${mobileLayout ? " hub-invites--mobile" : ""}`}>
      <h3>Invite a manager</h3>
      <p className="chart-note">{memberInviteExplainer()}</p>



      <label className="hub-lock-claims">
        <input type="checkbox" checked={lockClaims} disabled={busy} onChange={toggleLockClaims} />
        Lock team claims
      </label>

      <form className={`hub-form-row hub-invite-form${mobileLayout ? " hub-form-row--stack" : ""}`} onSubmit={sendInvite}>
        <label>
          <span className="hub-field-label">Manager email</span>
          <input
            type="email"
            value={email}
            disabled={busy}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="owner@example.com"
            required
          />
        </label>
        <label>
          <span className="hub-field-label">Team name</span>
          <input
            value={teamName}
            disabled={busy}
            onChange={(e) => setTeamName(e.target.value)}
            placeholder="Exact name from your spreadsheet"
            required
          />
        </label>
        {hubContext?.is_primary_commissioner && (
          <label className="hub-salary-toggle">
            <input
              type="checkbox"
              checked={coCommissioner}
              disabled={busy}
              onChange={(e) => setCoCommissioner(e.target.checked)}
            />
            Invite as co-commissioner
          </label>
        )}
        <button type="submit" className="btn-primary" disabled={busy}>
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
            <span className="chart-note">League membership link (share if email is not configured):</span>
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
              {teams.filter((t) => !(commissionerSub && t.user_sub && String(t.user_sub) === String(commissionerSub))).map((t) => (
                <div key={t.id} className="hub-invite-mobile-card">
                  <div>
                    <strong>{hubTeamLabel(t)}</strong>
                    <span className="table-meta">
                      {t.user_sub ? " · claimed" : " · unclaimed"}
                      {t.sleeper_roster_id ? " · Sleeper linked" : ""}
                      {t.is_commissioner && t.user_sub ? " · co-commish" : ""}
                    </span>
                  </div>
                  {t.user_sub ? (
                    <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => releaseClaim(t.id)}>
                      Release claim
                    </button>
                  ) : null}
                </div>
              ))}
            </MobileDataList>
          ) : (
          <ul className="hub-invite-list">
            {teams.filter((t) => !(commissionerSub && t.user_sub && String(t.user_sub) === String(commissionerSub))).map((t) => (
              <li key={t.id}>
                <strong>{hubTeamLabel(t)}</strong>
                {t.user_sub ? (
                  <>
                    <span className="table-meta">
                      {" · claimed"}
                      {t.sleeper_roster_id ? " · Sleeper linked" : ""}
                      {t.is_commissioner ? " · co-commish" : ""}
                    </span>
                    <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => releaseClaim(t.id)}>
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
                <span className="table-meta">
                  {" · "}{inv.email}
                  {inv.co_commissioner ? " · co-commish" : ""}
                </span>
                <div className="hub-toolbar">
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    onClick={() => copyLink(`${window.location.origin}${leagueInvitePath(inv.token)}`)}
                  >
                    Copy link
                  </button>
                  <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => revokeInvite(inv.id)}>
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
